import cv2
import numpy as np

def apply_brightness(img, value):
    return cv2.convertScaleAbs(img, alpha=1.0, beta=value)

def apply_sharpness(img, value):
    if value <= 0:
        return img
    kernel = np.array([[0, -1, 0],
                       [-1, 5 + value / 10, -1],
                       [0, -1, 0]])
    return cv2.filter2D(img, -1, kernel)

def apply_noise_reduction(img, value):
    if value <= 0:
        return img
    k = max(1, (value // 10) * 2 + 1)
    return cv2.medianBlur(img, k)

# 🔥 NEW: RGB filter
def apply_rgb(img, r, g, b):
    """
    r, g, b are in range [-100, 100]
    """
    img = img.astype(np.float32)

    # OpenCV uses BGR order
    img[:, :, 2] *= (1 + r / 100.0)  # Red
    img[:, :, 1] *= (1 + g / 100.0)  # Green
    img[:, :, 0] *= (1 + b / 100.0)  # Blue

    img = np.clip(img, 0, 255)
    return img.astype(np.uint8)

def apply_grayscale(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

def remove_background(img):
    """
    Remove background using GrabCut.
    Returns image with transparent background (RGBA).
    """
    h, w = img.shape[:2]

    # Initial mask
    mask = np.zeros((h, w), np.uint8)

    # Rectangle slightly inside image borders
    rect = (10, 10, w - 20, h - 20)

    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)

    cv2.grabCut(img, mask, rect, bgdModel, fgdModel, 5, cv2.GC_INIT_WITH_RECT)

    # Convert mask to binary
    mask2 = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
        1,
        0
    ).astype("uint8")

    # Apply mask
    result = img * mask2[:, :, np.newaxis]

    # Convert to RGBA
    b, g, r = cv2.split(result)
    alpha = (mask2 * 255).astype(np.uint8)

    return cv2.merge([b, g, r, alpha])

def apply_crop(img, crop):
    """
    crop: dict with {enabled: bool, x: float, y: float, w: float, h: float}
    normalized [0..1]
    """
    if not crop or not crop.get("enabled", False):
        return img

    h, w = img.shape[:2]

    x = int(max(0, min(1, crop.get("x", 0))) * w)
    y = int(max(0, min(1, crop.get("y", 0))) * h)
    cw = int(max(0, min(1, crop.get("w", 1))) * w)
    ch = int(max(0, min(1, crop.get("h", 1))) * h)

    # ensure valid size
    cw = max(1, min(cw, w - x))
    ch = max(1, min(ch, h - y))

    return img[y:y+ch, x:x+cw]

def process_image(img, params):
    img = apply_brightness(img, params.get("brightness", 0))
    img = apply_sharpness(img, params.get("sharpness", 0))
    img = apply_noise_reduction(img, params.get("denoise", 0))

    if params.get("mono", False):
        img = apply_grayscale(img)
    else:
        img = apply_rgb(
            img,
            params.get("red", 0),
            params.get("green", 0),
            params.get("blue", 0),
        )

    return img
