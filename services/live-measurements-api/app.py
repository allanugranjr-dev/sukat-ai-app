

import hmac
import math
import os
from threading import Lock

import cv2
import numpy as np
import mediapipe as mp
from flask import Flask, request, jsonify

try:
    import torch
    import torch.nn.functional as F
except ImportError:
    # MiDaS is optional. The calibrated pose/segmentation path keeps the
    # local provider usable without downloading the multi-gigabyte PyTorch
    # stack on a development laptop.
    torch = None
    F = None


app = Flask(__name__)

mp_pose = mp.solutions.pose
mp_holistic = mp.solutions.holistic
pose = mp_pose.Pose(
    static_image_mode=True,
    model_complexity=2,
    enable_segmentation=True,
)  # Improved accuracy for independent uploaded views
holistic = mp_holistic.Holistic(
    static_image_mode=True,
    model_complexity=2,
    enable_segmentation=False,
    refine_face_landmarks=False,
)  # Independent landmark pass for each uploaded view
inference_lock = Lock()

KNOWN_OBJECT_WIDTH_CM = 21.0  # A4 paper width in cm
FOCAL_LENGTH = 600  # Default focal length


def require_provider_key():
    """Require a server-to-server key before doing expensive image processing."""
    expected_key = os.environ.get("PROVIDER_API_KEY", "").strip()
    if not expected_key:
        return jsonify({"error": "PROVIDER_API_KEY is not configured."}), 503

    authorization = request.headers.get("Authorization", "")
    expected_authorization = f"Bearer {expected_key}"
    if not hmac.compare_digest(authorization, expected_authorization):
        return jsonify({"error": "Unauthorized."}), 401

    return None


def first_uploaded_file(*field_names):
    """Return the first non-empty upload, supporting both provider contracts."""
    for field_name in field_names:
        candidate = request.files.get(field_name)
        if candidate is not None and candidate.filename:
            return candidate
    return None


def parse_user_height():
    """Require a plausible height so the provider never silently guesses scale."""
    raw_height = request.form.get("height_cm") or request.form.get("user_height_cm")
    if raw_height is None or not raw_height.strip():
        return None, (jsonify({"error": "height_cm is required."}), 400)

    try:
        user_height_cm = float(raw_height)
    except (TypeError, ValueError):
        return None, (jsonify({"error": "height_cm must be a number."}), 400)

    if not math.isfinite(user_height_cm) or not 120 <= user_height_cm <= 230:
        return None, (jsonify({"error": "height_cm must be between 120 and 230 cm."}), 400)

    return user_height_cm, None

# Load depth estimation model
def load_depth_model():
    depth_enabled = os.environ.get("USE_DEPTH_MODEL", "0").strip().lower() in {"1", "true", "yes"}
    if not depth_enabled or torch is None:
        return None

    try:
        model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
        model.eval()
        return model
    except Exception as error:
        print(f"MiDaS depth model unavailable; using pose calibration only: {error}")
        return None

depth_model = load_depth_model()

def calibrate_focal_length(image, real_width_cm, detected_width_px):
    """Dynamically calibrates focal length using a known object."""
    return (detected_width_px * FOCAL_LENGTH) / real_width_cm if detected_width_px else FOCAL_LENGTH



def detect_reference_object(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest_contour = max(contours, key=cv2.contourArea)
        x, y, w, h = cv2.boundingRect(largest_contour)
        focal_length = calibrate_focal_length(image, KNOWN_OBJECT_WIDTH_CM, w)
        scale_factor = KNOWN_OBJECT_WIDTH_CM / w
        return scale_factor, focal_length
    return 0.05, FOCAL_LENGTH

def estimate_depth(image):
    """Uses AI-based depth estimation to improve circumference calculations."""
    if depth_model is None or torch is None or F is None:
        return None

    input_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) / 255.0
    input_tensor = torch.tensor(input_image, dtype=torch.float32).permute(2, 0, 1).unsqueeze(0)
    
    # Resize input to match MiDaS model input size
    input_tensor = F.interpolate(input_tensor, size=(384, 384), mode="bilinear", align_corners=False)

    with torch.no_grad():
        depth_map = depth_model(input_tensor)
    
    return depth_map.squeeze().numpy()


def get_visible_landmark(landmarks, landmark, minimum_visibility=0.35):
    """Read a pose landmark only when it is inside the image and trustworthy."""
    point = landmarks[landmark.value]
    visibility = getattr(point, "visibility", 1.0)
    if visibility < minimum_visibility or not 0 <= point.x <= 1 or not 0 <= point.y <= 1:
        return None
    return point


def estimate_person_height_px(landmarks, image_height):
    """Estimate the full head-to-foot span instead of using nose-to-ankle only."""
    nose = get_visible_landmark(landmarks, mp_pose.PoseLandmark.NOSE)
    shoulder_points = [
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_SHOULDER),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_SHOULDER),
    ]
    foot_points = [
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_HEEL),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_HEEL),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_FOOT_INDEX),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_FOOT_INDEX),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_ANKLE),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_ANKLE),
    ]

    if nose is None or not any(shoulder_points) or not any(foot_points):
        return None

    shoulder_y = np.mean([point.y for point in shoulder_points if point is not None])
    nose_y = nose.y
    # MediaPipe has no crown-of-head landmark. Use the detected head-to-shoulder
    # distance to estimate the small missing crown segment, with a safe minimum.
    crown_extension_px = max(abs(shoulder_y - nose_y) * image_height * 0.65, image_height * 0.025)
    top_head_px = nose_y * image_height - crown_extension_px
    bottom_foot_px = max(point.y for point in foot_points if point is not None) * image_height
    return max(bottom_foot_px - top_head_px, 1.0)


def get_segmented_width_at_height(segmentation_mask, height_px, center_x, frame_shape):
    """Measure the silhouette row containing the body, not the background threshold."""
    if segmentation_mask is None or frame_shape is None:
        return None

    frame_height, frame_width = frame_shape[:2]
    mask_height, mask_width = segmentation_mask.shape[:2]
    if frame_height <= 1 or frame_width <= 1 or mask_height <= 1 or mask_width <= 1:
        return None

    row_index = int(np.clip(height_px / frame_height * mask_height, 0, mask_height - 1))
    center_index = int(np.clip(center_x * mask_width, 0, mask_width - 1))
    row = np.asarray(segmentation_mask[row_index], dtype=np.float32)
    binary = row >= 0.35

    # Close tiny segmentation gaps caused by clothing texture or hands.
    smoothed = np.convolve(binary.astype(np.uint8), np.ones(7, dtype=np.uint8), mode="same") >= 4
    indices = np.flatnonzero(smoothed)
    if indices.size == 0:
        return None

    split_points = np.flatnonzero(np.diff(indices) > 1) + 1
    runs = np.split(indices, split_points)
    containing_runs = [run for run in runs if run[0] <= center_index <= run[-1]]
    if containing_runs:
        selected = max(containing_runs, key=len)
    else:
        selected = min(runs, key=lambda run: min(abs(run[0] - center_index), abs(run[-1] - center_index)))

    width_px = (selected[-1] - selected[0] + 1) * frame_width / mask_width
    return float(width_px) if width_px >= frame_width * 0.02 else None


def ellipse_circumference(width_cm, depth_cm=None, fallback_depth_ratio=0.7):
    """Approximate a body cross-section with Ramanujan's ellipse formula."""
    if width_cm <= 0:
        return 0.0

    if depth_cm is None or depth_cm <= 0:
        depth_cm = width_cm * fallback_depth_ratio
    else:
        # Reject impossible side silhouettes while retaining useful estimates.
        depth_cm = float(np.clip(depth_cm, width_cm * 0.25, width_cm * 0.95))

    semi_major = width_cm / 2
    semi_minor = depth_cm / 2
    return round(
        np.pi * (
            3 * (semi_major + semi_minor)
            - np.sqrt((3 * semi_major + semi_minor) * (semi_major + 3 * semi_minor))
        ),
        2,
    )


def estimate_side_depths(side_results, side_mask, side_frame, side_scale_factor):
    """Turn a profile silhouette into depth diameters for torso circumferences."""
    if side_results is None or not side_results.pose_landmarks or side_frame is None or not side_scale_factor:
        return {}

    landmarks = side_results.pose_landmarks.landmark
    shoulder_points = [
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_SHOULDER),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_SHOULDER),
    ]
    hip_points = [
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_HIP),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_HIP),
    ]
    knee_points = [
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.LEFT_KNEE),
        get_visible_landmark(landmarks, mp_pose.PoseLandmark.RIGHT_KNEE),
    ]
    if not all((any(shoulder_points), any(hip_points), any(knee_points))):
        return {}

    shoulder_y = float(np.mean([point.y for point in shoulder_points if point is not None]))
    shoulder_x = float(np.mean([point.x for point in shoulder_points if point is not None]))
    hip_y = float(np.mean([point.y for point in hip_points if point is not None]))
    hip_x = float(np.mean([point.x for point in hip_points if point is not None]))
    knee_y = float(np.mean([point.y for point in knee_points if point is not None]))
    knee_x = float(np.mean([point.x for point in knee_points if point is not None]))

    targets = {
        "chest": (shoulder_y + (hip_y - shoulder_y) * 0.45, shoulder_x),
        "waist": (shoulder_y + (hip_y - shoulder_y) * 0.62, hip_x),
        "hip": (hip_y + (knee_y - hip_y) * 0.10, hip_x),
        "thigh": (hip_y + (knee_y - hip_y) * 0.20, knee_x),
    }
    depths = {}
    for name, (target_y, center_x) in targets.items():
        width_px = get_segmented_width_at_height(
            side_mask,
            target_y * side_frame.shape[0],
            center_x,
            side_frame.shape,
        )
        if width_px is not None:
            depth_cm = width_px * side_scale_factor
            if 3 <= depth_cm <= 100:
                depths[name] = round(depth_cm, 2)
    return depths


def calculate_distance_using_height(landmarks, image_height, user_height_cm):
    """Calculate distance using the user's known height."""
    person_height_px = estimate_person_height_px(landmarks, image_height)
    if person_height_px is None:
        raise ValueError("Could not calibrate full body height from the front image.")
    
    # Using the formula: distance = (actual_height_cm * focal_length) / height_in_pixels
    distance = (user_height_cm * FOCAL_LENGTH) / person_height_px
    
    # Calculate more accurate scale_factor based on known height
    scale_factor = user_height_cm / person_height_px
    
    return distance, scale_factor

def get_body_width_at_height(frame, height_px, center_x):
    """Scan horizontally at a specific height to find body edges."""
    # Convert to grayscale and apply threshold
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 50, 255, cv2.THRESH_BINARY)
    
    # Ensure height_px is within image bounds
    if height_px >= frame.shape[0]:
        height_px = frame.shape[0] - 1
    
    # Get horizontal line at the specified height
    horizontal_line = thresh[height_px, :]
    
    # Find left and right edges starting from center
    center_x = int(center_x * frame.shape[1])
    left_edge, right_edge = center_x, center_x
    
    # Scan from center to left
    for i in range(center_x, 0, -1):
        if horizontal_line[i] == 0:  # Found edge (black pixel)
            left_edge = i
            break
    
    # Scan from center to right
    for i in range(center_x, len(horizontal_line)):
        if horizontal_line[i] == 0:  # Found edge (black pixel)
            right_edge = i
            break
            
    width_px = right_edge - left_edge
    
    # If width is unreasonably small, apply a minimum width
    min_width = 0.1 * frame.shape[1]  # Minimum width as 10% of image width
    if width_px < min_width:
        width_px = min_width
        
    return width_px

def calculate_measurements(
    results,
    scale_factor,
    image_width,
    image_height,
    depth_map,
    frame=None,
    user_height_cm=None,
    segmentation_mask=None,
    depth_profile_cm=None,
):
    landmarks = results.pose_landmarks.landmark
    depth_profile_cm = depth_profile_cm or {}

    # If user's height is provided, use it to get a more accurate scale factor
    if user_height_cm:
        _, scale_factor = calculate_distance_using_height(landmarks, image_height, user_height_cm)

    def pixel_to_cm(value):
        return round(value * scale_factor, 2)
    
    def calculate_circumference(width_px, depth_ratio=1.0, profile_name=None):
        width_cm = width_px * scale_factor
        return ellipse_circumference(
            width_cm,
            depth_profile_cm.get(profile_name),
            fallback_depth_ratio=float(np.clip(depth_ratio * 0.7, 0.35, 0.9)),
        )

    measurements = {}

    # Shoulder Width
    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
    shoulder_width_px = abs(left_shoulder.x * image_width - right_shoulder.x * image_width)
    
    measurements["shoulder_width"] = pixel_to_cm(shoulder_width_px)

    # Chest/Bust Measurement
    # Sample a torso row below the shoulder/upper-arm junction so arms are not
    # counted as chest width when the person is standing with arms down.
    chest_y_ratio = 0.45
    chest_y = left_shoulder.y + (landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y - left_shoulder.y) * chest_y_ratio
    
    chest_width_px = abs((right_shoulder.x - left_shoulder.x) * image_width)

    if frame is not None and segmentation_mask is not None:
        chest_y_px = int(chest_y * image_height)
        center_x = (left_shoulder.x + right_shoulder.x) / 2
        detected_width = get_segmented_width_at_height(
            segmentation_mask, chest_y_px, center_x, frame.shape
        )
        if detected_width is not None:
            chest_width_px = detected_width
    
    chest_depth_ratio = 1.0
    if depth_map is not None:
        chest_x = int(((left_shoulder.x + right_shoulder.x) / 2) * image_width)
        chest_y_px = int(chest_y * image_height)
        scale_y = 384 / image_height
        scale_x = 384 / image_width
        chest_y_scaled = int(chest_y_px * scale_y)
        chest_x_scaled = int(chest_x * scale_x)
        if 0 <= chest_y_scaled < 384 and 0 <= chest_x_scaled < 384:
            chest_depth = depth_map[chest_y_scaled, chest_x_scaled]
            max_depth = np.max(depth_map)
            chest_depth_ratio = 1.0 + 0.5 * (1.0 - chest_depth / max_depth)
    
    measurements["chest_width"] = pixel_to_cm(chest_width_px)
    measurements["chest_circumference"] = calculate_circumference(
        chest_width_px, chest_depth_ratio, "chest"
    )
    

    # Waist Measurement
    left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP.value]
    right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value]

    # Adjust waist_y_ratio to better reflect the natural waistline
    # The natural waist is lower than the rib cage; this avoids the broad
    # shoulder and upper-arm silhouette being mistaken for the waist.
    waist_y_ratio = 0.62
    waist_y = left_shoulder.y + (left_hip.y - left_shoulder.y) * waist_y_ratio

    # Use the pose segmentation silhouette when available; a raw grayscale
    # threshold is too sensitive to dark clothing and room backgrounds.
    if frame is not None and segmentation_mask is not None:
        waist_y_px = int(waist_y * image_height)
        center_x = (left_hip.x + right_hip.x) / 2
        detected_width = get_segmented_width_at_height(
            segmentation_mask, waist_y_px, center_x, frame.shape
        )
        if detected_width is not None:
            waist_width_px = detected_width
        else:
            waist_width_px = abs(right_hip.x - left_hip.x) * image_width * 0.9
    else:
        waist_width_px = abs(right_hip.x - left_hip.x) * image_width * 0.9

    # Get depth adjustment for waist if available
    waist_depth_ratio = 1.0
    if depth_map is not None:
        waist_x = int(((left_hip.x + right_hip.x) / 2) * image_width)
        waist_y_px = int(waist_y * image_height)
        scale_y = 384 / image_height
        scale_x = 384 / image_width
        waist_y_scaled = int(waist_y_px * scale_y)
        waist_x_scaled = int(waist_x * scale_x)
        if 0 <= waist_y_scaled < 384 and 0 <= waist_x_scaled < 384:
            waist_depth = depth_map[waist_y_scaled, waist_x_scaled]
            max_depth = np.max(depth_map)
            waist_depth_ratio = 1.0 + 0.5 * (1.0 - waist_depth / max_depth)

    measurements["waist_width"] = pixel_to_cm(waist_width_px)
    measurements["waist"] = calculate_circumference(waist_width_px, waist_depth_ratio, "waist")
    # Hip Measurement
    hip_width_px = abs(left_hip.x * image_width - right_hip.x * image_width) * 1.15
    
    if frame is not None and segmentation_mask is not None:
        hip_y_offset = 0.1  # 10% down from hip landmarks
        hip_y = left_hip.y + (landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].y - left_hip.y) * hip_y_offset
        hip_y_px = int(hip_y * image_height)
        center_x = (left_hip.x + right_hip.x) / 2
        detected_width = get_segmented_width_at_height(
            segmentation_mask, hip_y_px, center_x, frame.shape
        )
        if detected_width is not None:
            hip_width_px = detected_width
    
    hip_depth_ratio = 1.0
    if depth_map is not None:
        hip_x = int(((left_hip.x + right_hip.x) / 2) * image_width)
        hip_y_px = int(left_hip.y * image_height)
        hip_y_scaled = int(hip_y_px * scale_y)
        hip_x_scaled = int(hip_x * scale_x)
        if 0 <= hip_y_scaled < 384 and 0 <= hip_x_scaled < 384:
            hip_depth = depth_map[hip_y_scaled, hip_x_scaled]
            max_depth = np.max(depth_map)
            hip_depth_ratio = 1.0 + 0.5 * (1.0 - hip_depth / max_depth)
    
    measurements["hip_width"] = pixel_to_cm(hip_width_px)
    measurements["hip"] = calculate_circumference(hip_width_px, hip_depth_ratio, "hip")

    # Other measurements (unchanged)
    neck = landmarks[mp_pose.PoseLandmark.NOSE.value]
    left_ear = landmarks[mp_pose.PoseLandmark.LEFT_EAR.value]
    neck_width_px = abs(neck.x * image_width - left_ear.x * image_width) * 2.0
    measurements["neck"] = calculate_circumference(neck_width_px, 1.0)
    measurements["neck_width"] = pixel_to_cm(neck_width_px)

    left_wrist = landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value]
    sleeve_length_px = math.hypot(
        (left_shoulder.x - left_wrist.x) * image_width,
        (left_shoulder.y - left_wrist.y) * image_height,
    )
    measurements["arm_length"] = pixel_to_cm(sleeve_length_px)

    shirt_length_px = abs(left_shoulder.y * image_height - left_hip.y * image_height)
    measurements["shirt_length"] = pixel_to_cm(shirt_length_px)

     # Thigh Circumference (improved with depth information)
    thigh_y_ratio = 0.2  # 20% down from hip to knee
    left_knee = landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value]
    thigh_y = left_hip.y + (left_knee.y - left_hip.y) * thigh_y_ratio
    
    # Apply correction factor for thigh width
    thigh_width_px = hip_width_px * 0.5
    
    # Use contour detection if frame is available
    if frame is not None and segmentation_mask is not None:
        thigh_y_px = int(thigh_y * image_height)
        thigh_x = (left_hip.x + left_knee.x) / 2
        detected_width = get_segmented_width_at_height(
            segmentation_mask, thigh_y_px, thigh_x, frame.shape
        )
        if detected_width is not None and detected_width < hip_width_px:
            thigh_width_px = detected_width
    
    # If depth map is available, use it for thigh measurement
    thigh_depth_ratio = 1.0
    if depth_map is not None:
        thigh_x = int(left_hip.x * image_width)
        thigh_y_px = int(thigh_y * image_height)
        
        # Scale coordinates to match depth map size
        thigh_y_scaled = int(thigh_y_px * scale_y)
        thigh_x_scaled = int(thigh_x * scale_x)
        
        if 0 <= thigh_y_scaled < 384 and 0 <= thigh_x_scaled < 384:
            thigh_depth = depth_map[thigh_y_scaled, thigh_x_scaled]
            max_depth = np.max(depth_map)
            thigh_depth_ratio = 1.0 + 0.5 * (1.0 - thigh_depth / max_depth)
    
    measurements["thigh"] = pixel_to_cm(thigh_width_px)
    measurements["thigh_circumference"] = calculate_circumference(
        thigh_width_px, thigh_depth_ratio, "thigh"
    )


    left_ankle = landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value]
    trouser_length_px = math.hypot(
        (left_hip.x - left_ankle.x) * image_width,
        (left_hip.y - left_ankle.y) * image_height,
    )
    measurements["trouser_length"] = pixel_to_cm(trouser_length_px)

    return measurements


def validate_front_image(image_np):
    """
    Basic validation for front image to ensure:
    - There is a person in the image
    - Not just a face/selfie (upper body visible)
    - Key upper landmarks are detected
    """
    try:
        # Convert to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
        image_height, image_width = image_np.shape[:2]
        
        # Process with MediaPipe Holistic
        with mp_holistic.Holistic(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=False,
            refine_face_landmarks=False) as holistic:
            
            results = holistic.process(rgb_frame)
        
        if not hasattr(results, 'pose_landmarks') or not results.pose_landmarks:
            return False, "No person detected. Please make sure you're clearly visible in the frame."

        # Minimum required upper body landmarks
        MINIMUM_LANDMARKS = [
            mp_holistic.PoseLandmark.NOSE,
            mp_holistic.PoseLandmark.LEFT_SHOULDER,
            mp_holistic.PoseLandmark.RIGHT_SHOULDER,
            mp_holistic.PoseLandmark.LEFT_ELBOW,
            mp_holistic.PoseLandmark.RIGHT_ELBOW,
            mp_holistic.PoseLandmark.RIGHT_KNEE,
            mp_holistic.PoseLandmark.LEFT_KNEE,
            mp_holistic.PoseLandmark.LEFT_ANKLE,
            mp_holistic.PoseLandmark.RIGHT_ANKLE

           
        ]
        
        # Verify minimum landmarks are detected
        missing_upper = []
        for landmark in MINIMUM_LANDMARKS:
            landmark_data = results.pose_landmarks.landmark[landmark]
            if (landmark_data.visibility < 0.5 or
                landmark_data.x < 0 or 
                landmark_data.x > 1 or
                landmark_data.y < 0 or 
                landmark_data.y > 1):
                missing_upper.append(landmark.name.replace('_', ' '))
        
        if missing_upper:
            return False, f"Couldn't detect full body. Please make sure your full body is visible."

        # Check if this might be just a face/selfie (no torso)
        nose = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.NOSE]
        left_shoulder = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.LEFT_SHOULDER]
        right_shoulder = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.RIGHT_SHOULDER]
        
        # Calculate approximate upper body size
        shoulder_width = abs(left_shoulder.x - right_shoulder.x) * image_width
        head_to_shoulder = abs(left_shoulder.y - nose.y) * image_height
        
        # If the shoulder width is small compared to head size, likely a selfie
        if shoulder_width < head_to_shoulder * 1.2:
            return False, "Please step back to show more of your upper body, not just your face."

        return True, "Validation passed - proceeding with measurements"
        
    except Exception as e:
        print(f"Error validating body image: {e}")
        return False, "You arent providing images correctly. Please try again."
    
@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "sukat-ai-live-measurements",
        "depth_model_enabled": depth_model is not None,
    })


@app.route("/upload_images", methods=["POST"])
@app.route("/measurements", methods=["POST"])
def upload_images():
    auth_error = require_provider_key()
    if auth_error is not None:
        return auth_error

    front_image_file = first_uploaded_file("front", "front_image")
    if front_image_file is None:
        return jsonify({"error": "Missing front image for reference."}), 400

    user_height_cm, height_error = parse_user_height()
    if height_error is not None:
        return height_error
    
    front_image_np = np.frombuffer(front_image_file.read(), np.uint8)
    front_image_file.seek(0)  # Reset file pointer

    front_frame = cv2.imdecode(front_image_np, cv2.IMREAD_COLOR)
    if front_frame is None:
        return jsonify({"error": "The front upload is not a readable image."}), 400

    is_valid, error_msg = validate_front_image(front_frame)
    
    if not is_valid:
        return jsonify({
            "error": error_msg,
            "pose": "front",
            "code": "INVALID_POSE"
        }), 400
    
    side_image_file = first_uploaded_file("left_side", "side_image")
    received_images = {"front": front_image_file}
    if side_image_file is not None:
        received_images["left_side"] = side_image_file
    measurements, scale_factor, focal_length, results = {}, None, FOCAL_LENGTH, {}
    frames, pose_results, segmentation_masks, scale_factors = {}, {}, {}, {}
    
    for pose_name, image_file in received_images.items():
        image_np = np.frombuffer(image_file.read(), np.uint8)
        frame = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
        if frame is None:
            return jsonify({"error": f"The {pose_name} upload is not a readable image."}), 400
        frames[pose_name] = frame  # Store the frame for contour detection
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with inference_lock:
            results[pose_name] = holistic.process(rgb_frame)
            pose_results[pose_name] = pose.process(rgb_frame)
        segmentation_masks[pose_name] = getattr(pose_results[pose_name], "segmentation_mask", None)
        image_height, image_width, _ = frame.shape

        if results[pose_name].pose_landmarks:
            try:
                _, current_scale_factor = calculate_distance_using_height(
                    results[pose_name].pose_landmarks.landmark,
                    image_height,
                    user_height_cm,
                )
                scale_factors[pose_name] = current_scale_factor
                if pose_name == "front":
                    scale_factor = current_scale_factor
            except ValueError:
                if pose_name == "front":
                    return jsonify({
                        "error": "Could not calibrate full body height. Please keep your head and feet visible.",
                        "pose": "front",
                        "code": "INVALID_CALIBRATION",
                    }), 400

    if not results.get("front") or not results["front"].pose_landmarks or not scale_factor:
        return jsonify({
            "error": "Could not detect a full front-facing body for measurement.",
            "pose": "front",
            "code": "INVALID_POSE",
        }), 400

    front_frame = frames["front"]
    front_height, front_width = front_frame.shape[:2]
    side_depths = estimate_side_depths(
        results.get("left_side"),
        segmentation_masks.get("left_side"),
        frames.get("left_side"),
        scale_factors.get("left_side"),
    )
    measurements.update(calculate_measurements(
        results["front"],
        scale_factor,
        front_width,
        front_height,
        estimate_depth(front_frame),
        front_frame,
        user_height_cm,
        segmentation_masks.get("front"),
        side_depths,
    ))
    
    # Debug information to help troubleshoot measurements
    debug_info = {
        "scale_factor": float(scale_factor) if scale_factor else None,
        "focal_length": float(focal_length),
        "user_height_cm": float(user_height_cm),
        "side_image_received": side_image_file is not None,
        "side_depths_cm": side_depths,
        "processing_version": "sukat-ai-live-measurements-adapter-1"
    }

    print(measurements)
    
    return jsonify({ 
        "measurements": measurements,
        "debug_info": debug_info
    })

if __name__ == '__main__':
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8001")),
    )
