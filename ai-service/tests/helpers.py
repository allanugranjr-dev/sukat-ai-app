from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageDraw


def make_body_image(width: int = 480, height: int = 960) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((195, 35, 285, 145), fill="black")
    draw.rounded_rectangle((155, 135, 325, 605), radius=35, fill="black")
    draw.rectangle((105, 185, 155, 525), fill="black")
    draw.rectangle((325, 185, 375, 525), fill="black")
    draw.rectangle((175, 560, 238, 900), fill="black")
    draw.rectangle((242, 560, 305, 900), fill="black")
    draw.ellipse((157, 875, 240, 930), fill="black")
    draw.ellipse((240, 875, 323, 930), fill="black")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
