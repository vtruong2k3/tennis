"""
utils/audio_impact_detector.py
──────────────────────────────
Detects physical ball-racket impact candidates from video audio.

Why Audio Detection:
--------------------
A tennis racket strike (string-bed compression) is an impulsive transient with
sub-5ms onset and energy concentrated in the 1.8 kHz - 4.2 kHz frequency band.
Unlike visual ball tracking, which suffers from occlusion behind the player's
body or motion blur against court lines, acoustic impact signals travel directly
to the microphone, providing frame-exact contact candidates even when the ball
is invisible to camera generators.
"""
from __future__ import annotations

import logging
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import scipy.signal

logger = logging.getLogger(__name__)


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg executable is available in PATH."""
    return shutil.which("ffmpeg") is not None


def extract_audio_waveform(
    video_path: str,
    sample_rate: int = 16000,
) -> tuple[np.ndarray | None, int]:
    """
    Extract single-channel mono PCM audio from a video using ffmpeg streaming.
    Does not write intermediate audio files to disk.

    Returns:
        (waveform_float32, sample_rate), or (None, 0) if extraction fails or video has no audio.
    """
    if not is_ffmpeg_available():
        logger.warning("ffmpeg is not installed in PATH; skipping audio extraction.")
        return None, 0

    if not Path(video_path).exists():
        logger.warning(f"Video file does not exist: {video_path}")
        return None, 0

    cmd = [
        "ffmpeg",
        "-nostdin",
        "-threads", "1",
        "-v", "error",
        "-i", str(video_path),
        "-f", "s16le",
        "-ac", "1",
        "-ar", str(sample_rate),
        "pipe:1",
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, stderr = proc.communicate(timeout=60)
        if proc.returncode != 0 or len(stdout) == 0:
            logger.debug(f"No audio extracted from {video_path}: {stderr.decode('utf-8', errors='ignore')}")
            return None, 0

        # Convert raw s16le bytes to normalized float array [-1.0, 1.0]
        waveform = np.frombuffer(stdout, dtype=np.int16).astype(np.float32) / 32768.0
        return waveform, sample_rate
    except Exception as exc:
        logger.warning(f"Audio extraction failed for {video_path}: {exc}")
        return None, 0


class AudioImpactDetector:
    """
    Detects racket impact moments from audio waveform using Butterworth bandpass
    filtering and energy onset peak detection.
    """

    def __init__(
        self,
        bandpass_low: float = 1800.0,
        bandpass_high: float = 4200.0,
        min_interval_sec: float = 0.30,
        envelope_window_ms: float = 5.0,
        prominence_percentile: float = 90.0,
    ):
        self.bandpass_low = bandpass_low
        self.bandpass_high = bandpass_high
        self.min_interval_sec = min_interval_sec
        self.envelope_window_ms = envelope_window_ms
        self.prominence_percentile = prominence_percentile

    def detect_peaks_from_waveform(
        self,
        waveform: np.ndarray,
        sample_rate: int = 16000,
        fps: float = 30.0,
    ) -> list[int]:
        """
        Processes float32 waveform and returns detected impact frame indices.
        """
        if waveform is None or len(waveform) < sample_rate * 0.1:
            return []

        # Check for silent audio
        rms = float(np.sqrt(np.mean(waveform ** 2)))
        if rms < 1e-4:
            logger.debug("Audio waveform is silent (RMS < 1e-4); skipping impact detection.")
            return []

        # 1. 4th order Butterworth bandpass filter
        nyquist = sample_rate / 2.0
        low = max(100.0, min(self.bandpass_low, nyquist - 200.0))
        high = max(low + 100.0, min(self.bandpass_high, nyquist - 50.0))

        try:
            sos = scipy.signal.butter(4, [low, high], btype="bandpass", fs=sample_rate, output="sos")
            filtered = scipy.signal.sosfilt(sos, waveform)
        except Exception as exc:
            logger.warning(f"Bandpass filtering failed ({exc}); falling back to raw waveform.")
            filtered = waveform

        # 2. Compute short-term energy envelope
        window_samples = max(4, int((self.envelope_window_ms / 1000.0) * sample_rate))
        envelope = np.convolve(filtered ** 2, np.ones(window_samples) / window_samples, mode="same")

        # 3. Adaptive thresholding and peak picking
        p_val = float(np.percentile(envelope, self.prominence_percentile))
        min_prominence = max(1e-5, p_val * 1.8)
        min_dist_samples = max(1, int(self.min_interval_sec * sample_rate))

        peaks, _ = scipy.signal.find_peaks(
            envelope,
            distance=min_dist_samples,
            prominence=min_prominence,
        )

        # 4. Convert sample offsets to video frame indices
        frames: list[int] = []
        for p in peaks:
            t_sec = float(p) / float(sample_rate)
            f_idx = int(round(t_sec * fps))
            if f_idx >= 0:
                frames.append(f_idx)

        return sorted(set(frames))

    def detect_impact_candidates(
        self,
        video_path: str,
        fps: float = 30.0,
        sample_rate: int = 16000,
    ) -> list[int]:
        """
        Convenience end-to-end method extracting audio and detecting peaks.
        """
        waveform, sr = extract_audio_waveform(video_path, sample_rate=sample_rate)
        if waveform is None:
            return []
        return self.detect_peaks_from_waveform(waveform, sample_rate=sr, fps=fps)


def detect_audio_impact_candidates(
    video_path: str,
    fps: float = 30.0,
) -> list[int]:
    """Module-level entry point for candidate proposal."""
    detector = AudioImpactDetector()
    return detector.detect_impact_candidates(video_path, fps=fps)
