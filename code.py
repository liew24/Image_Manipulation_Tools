"""
Draft: PySide6 + OpenCV mini image editor (single-file)

Features:
- Open image
- Show original + preview
- Choose tool (Blur / Threshold / Brightness-Contrast / Edge)
- Interactive sliders (parameters update preview)
- Save output
- Reset

Install:
  pip install pyside6 opencv-python numpy
"""

import sys
import cv2
import numpy as np

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel, QPushButton, QFileDialog,
    QHBoxLayout, QVBoxLayout, QGroupBox, QComboBox, QSlider, QFormLayout,
    QMessageBox, QSplitter
)


def cv_to_qpixmap(bgr: np.ndarray) -> QPixmap:
    """Convert OpenCV BGR image -> QPixmap for display."""
    if bgr is None:
        return QPixmap()

    # Ensure 3-channel BGR for display
    if len(bgr.shape) == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w, ch = rgb.shape
    bytes_per_line = ch * w
    qimg = QImage(rgb.data, w, h, bytes_per_line, QImage.Format_RGB888)
    return QPixmap.fromImage(qimg)


def odd_kernel(x: int) -> int:
    """Force kernel size to be odd and >= 1."""
    x = max(1, int(x))
    return x if x % 2 == 1 else x + 1


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("V.A.L.O. Draft Editor (PySide6 + OpenCV)")
        self.resize(1200, 700)

        self.original_bgr: np.ndarray | None = None
        self.current_bgr: np.ndarray | None = None

        # --- UI: Image panels ---
        self.lbl_original = QLabel("Open an image to begin")
        self.lbl_preview = QLabel("Preview")
        for lbl in (self.lbl_original, self.lbl_preview):
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setMinimumSize(400, 400)
            lbl.setStyleSheet("border: 1px solid #999; background: #111; color: #ddd;")

        img_wrap = QWidget()
        img_layout = QHBoxLayout(img_wrap)
        img_layout.addWidget(self.lbl_original)
        img_layout.addWidget(self.lbl_preview)

        # --- UI: Controls ---
        self.btn_open = QPushButton("Open Image")
        self.btn_save = QPushButton("Save Output")
        self.btn_reset = QPushButton("Reset")
        self.btn_apply = QPushButton("Apply")

        self.btn_save.setEnabled(False)
        self.btn_reset.setEnabled(False)
        self.btn_apply.setEnabled(False)

        self.tool_combo = QComboBox()
        self.tool_combo.addItems([
            "Blur (Gaussian)",
            "Threshold (Binary)",
            "Brightness / Contrast",
            "Edge (Canny)"
        ])

        # Sliders (we'll reuse them across tools)
        self.s1 = QSlider(Qt.Horizontal)
        self.s2 = QSlider(Qt.Horizontal)

        self.s1.setRange(0, 100)
        self.s2.setRange(0, 100)
        self.s1.setValue(10)
        self.s2.setValue(50)

        self.s1_label = QLabel("")
        self.s2_label = QLabel("")

        form = QFormLayout()
        form.addRow("Tool:", self.tool_combo)
        form.addRow(self.s1_label, self.s1)
        form.addRow(self.s2_label, self.s2)

        group_params = QGroupBox("Parameters")
        group_params.setLayout(form)

        controls = QWidget()
        controls_layout = QVBoxLayout(controls)
        top_btns = QHBoxLayout()
        top_btns.addWidget(self.btn_open)
        top_btns.addWidget(self.btn_save)
        top_btns.addWidget(self.btn_reset)

        controls_layout.addLayout(top_btns)
        controls_layout.addWidget(group_params)
        controls_layout.addWidget(self.btn_apply)
        controls_layout.addStretch(1)

        # Splitter: controls left, images right
        splitter = QSplitter()
        splitter.addWidget(controls)
        splitter.addWidget(img_wrap)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

        container = QWidget()
        root = QVBoxLayout(container)
        root.addWidget(splitter)
        self.setCentralWidget(container)

        # --- Signals ---
        self.btn_open.clicked.connect(self.open_image)
        self.btn_save.clicked.connect(self.save_image)
        self.btn_reset.clicked.connect(self.reset_image)
        self.btn_apply.clicked.connect(self.apply_commit)

        self.tool_combo.currentIndexChanged.connect(self.refresh_param_ui)
        self.s1.valueChanged.connect(self.update_param_text_and_preview)
        self.s2.valueChanged.connect(self.update_param_text_and_preview)

        self.refresh_param_ui()

    # ----------------- File I/O -----------------
    def open_image(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Image", "", "Images (*.png *.jpg *.jpeg *.bmp *.tif *.tiff)"
        )
        if not path:
            return

        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if bgr is None:
            QMessageBox.warning(self, "Error", "Could not open image.")
            return

        self.original_bgr = bgr
        self.current_bgr = bgr.copy()

        self.btn_save.setEnabled(True)
        self.btn_reset.setEnabled(True)
        self.btn_apply.setEnabled(True)

        self.render_images()
        self.update_param_text_and_preview()

    def save_image(self):
        if self.current_bgr is None:
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Output", "output.png", "PNG (*.png);;JPG (*.jpg *.jpeg);;BMP (*.bmp);;TIFF (*.tif *.tiff)"
        )
        if not path:
            return
        ok = cv2.imwrite(path, self.current_bgr)
        if not ok:
            QMessageBox.warning(self, "Error", "Failed to save image.")
        else:
            QMessageBox.information(self, "Saved", "Output image saved successfully.")

    def reset_image(self):
        if self.original_bgr is None:
            return
        self.current_bgr = self.original_bgr.copy()
        self.render_images()
        self.update_param_text_and_preview()

    # ----------------- Processing -----------------
    def process_preview(self) -> np.ndarray | None:
        """Return a processed preview (does NOT commit)."""
        if self.current_bgr is None:
            return None

        img = self.current_bgr.copy()
        tool = self.tool_combo.currentText()

        if tool == "Blur (Gaussian)":
            # s1 controls kernel size, s2 controls sigma (roughly)
            k = odd_kernel(self.s1.value() // 2 * 2 + 1)  # keep it odd
            sigma = max(0, self.s2.value() / 10.0)
            out = cv2.GaussianBlur(img, (k, k), sigmaX=sigma)

        elif tool == "Threshold (Binary)":
            # Convert to gray, threshold with s1 value, invert toggle via s2 (>50)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            thr = int(self.s1.value() * 255 / 100)
            invert = self.s2.value() > 50
            ttype = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
            _, outg = cv2.threshold(gray, thr, 255, ttype)
            out = cv2.cvtColor(outg, cv2.COLOR_GRAY2BGR)

        elif tool == "Brightness / Contrast":
            # s1 = brightness (-100..+100), s2 = contrast (0.5..2.0)
            beta = int((self.s1.value() - 50) * 4)  # -200..+200 approx
            alpha = 0.5 + (self.s2.value() / 100.0) * 1.5  # 0.5..2.0
            out = cv2.convertScaleAbs(img, alpha=alpha, beta=beta)

        elif tool == "Edge (Canny)":
            # s1 = low threshold, s2 = high threshold
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            low = int(self.s1.value() * 255 / 100)
            high = int(self.s2.value() * 255 / 100)
            if high < low:
                high = low
            edges = cv2.Canny(gray, low, high)
            out = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)

        else:
            out = img

        return out

    def apply_commit(self):
        """Commit current preview into current_bgr (like Photoshop 'Apply')."""
        out = self.process_preview()
        if out is not None:
            self.current_bgr = out
            self.render_images()
            self.update_param_text_and_preview()

    # ----------------- UI helpers -----------------
    def render_images(self):
        """Render original and current images."""
        if self.original_bgr is not None:
            pix = cv_to_qpixmap(self.original_bgr)
            self.lbl_original.setPixmap(pix.scaled(
                self.lbl_original.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
            ))
        if self.current_bgr is not None:
            # Show committed image in preview (will be overwritten by live preview below)
            pix = cv_to_qpixmap(self.current_bgr)
            self.lbl_preview.setPixmap(pix.scaled(
                self.lbl_preview.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
            ))

    def refresh_param_ui(self):
        tool = self.tool_combo.currentText()

        if tool == "Blur (Gaussian)":
            self.s1_label.setText("Kernel size")
            self.s2_label.setText("Sigma")
            self.s1.setRange(1, 31)
            self.s2.setRange(0, 50)
            self.s1.setValue(9)
            self.s2.setValue(10)

        elif tool == "Threshold (Binary)":
            self.s1_label.setText("Threshold")
            self.s2_label.setText("Invert (<=50 off, >50 on)")
            self.s1.setRange(0, 100)
            self.s2.setRange(0, 100)
            self.s1.setValue(50)
            self.s2.setValue(0)

        elif tool == "Brightness / Contrast":
            self.s1_label.setText("Brightness")
            self.s2_label.setText("Contrast")
            self.s1.setRange(0, 100)   # maps to negative..positive in code
            self.s2.setRange(0, 100)   # maps to 0.5..2.0 in code
            self.s1.setValue(50)
            self.s2.setValue(50)

        elif tool == "Edge (Canny)":
            self.s1_label.setText("Low threshold")
            self.s2_label.setText("High threshold")
            self.s1.setRange(0, 100)
            self.s2.setRange(0, 100)
            self.s1.setValue(20)
            self.s2.setValue(60)

        self.update_param_text_and_preview()

    def update_param_text_and_preview(self):
        """Update labels + show live preview (without committing)."""
        if self.current_bgr is None:
            return

        tool = self.tool_combo.currentText()

        # Update label text with current values (nice for marking)
        if tool == "Blur (Gaussian)":
            k = odd_kernel(self.s1.value())
            sigma = max(0, self.s2.value() / 10.0)
            self.s1_label.setText(f"Kernel size (odd): {k}")
            self.s2_label.setText(f"Sigma: {sigma:.1f}")

        elif tool == "Threshold (Binary)":
            thr = int(self.s1.value() * 255 / 100)
            invert = "ON" if self.s2.value() > 50 else "OFF"
            self.s1_label.setText(f"Threshold: {thr}")
            self.s2_label.setText(f"Invert: {invert} (toggle with slider)")

        elif tool == "Brightness / Contrast":
            beta = int((self.s1.value() - 50) * 4)
            alpha = 0.5 + (self.s2.value() / 100.0) * 1.5
            self.s1_label.setText(f"Brightness (beta): {beta}")
            self.s2_label.setText(f"Contrast (alpha): {alpha:.2f}")

        elif tool == "Edge (Canny)":
            low = int(self.s1.value() * 255 / 100)
            high = int(self.s2.value() * 255 / 100)
            if high < low:
                high = low
            self.s1_label.setText(f"Low threshold: {low}")
            self.s2_label.setText(f"High threshold: {high}")

        # Live preview
        out = self.process_preview()
        if out is not None:
            pix = cv_to_qpixmap(out)
            self.lbl_preview.setPixmap(pix.scaled(
                self.lbl_preview.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
            ))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        # Re-render on resize to keep aspect ratio correct
        self.render_images()
        self.update_param_text_and_preview()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())
