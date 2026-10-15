"""
tests/test_audio_impact_detector.py
Unit tests for AudioImpactDetector:
- Synthetic audio burst detection with 2.5 kHz resonant carrier
- Silence and short audio handling
- Frame conversion accuracy
"""
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.audio_impact_detector import AudioImpactDetector, extract_audio_waveform


def test_silent_audio_returns_empty():
    detector = AudioImpactDetector()
    silence = np.zeros(16000 * 2, dtype=np.float32)
    peaks = detector.detect_peaks_from_waveform(silence, sample_rate=16000, fps=30.0)
    assert peaks == []


def test_short_audio_returns_empty():
    detector = AudioImpactDetector()
    short_signal = np.random.randn(500).astype(np.float32) * 0.01
    peaks = detector.detect_peaks_from_waveform(short_signal, sample_rate=16000, fps=30.0)
    assert peaks == []


def test_detects_synthetic_transient_bursts():
    """
    Synthesize two tennis racket impacts at t=1.0s and t=2.5s:
    Carrier: 2500 Hz damped sinusoid with rapid <5ms onset and 25ms decay.
    """
    sr = 16000
    duration = 4.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    signal = np.random.randn(len(t)).astype(np.float32) * 0.002  # background noise

    for impact_time in (1.0, 2.5):
        start_idx = int(impact_time * sr)
        burst_len = int(0.04 * sr) # 40ms burst
        tb = np.linspace(0, 0.04, burst_len, endpoint=False)
        # 2500 Hz carrier with exponential decay
        burst = np.sin(2 * np.pi * 2500 * tb) * np.exp(-tb / 0.008) * 0.8
        signal[start_idx:start_idx + burst_len] += burst.astype(np.float32)

    detector = AudioImpactDetector(min_interval_sec=0.30)
    fps = 30.0
    peaks = detector.detect_peaks_from_waveform(signal, sample_rate=sr, fps=fps)

    # Frame for 1.0s is 30, for 2.5s is 75
    assert len(peaks) == 2
    assert abs(peaks[0] - 30) <= 1
    assert abs(peaks[1] - 75) <= 1


def test_real_audio_extraction_if_video_exists():
    video_path = Path("input_videos/input_video_2.mp4")
    if not video_path.exists():
        pytest.skip("Reference clip input_video_2.mp4 not found on disk")

    waveform, sr = extract_audio_waveform(str(video_path), sample_rate=16000)
    if waveform is None:
        pytest.skip("Audio stream extraction skipped (ffmpeg or audio track unavailable)")

    assert len(waveform) > 0
    assert sr == 16000

    detector = AudioImpactDetector()
    peaks = detector.detect_peaks_from_waveform(waveform, sample_rate=sr, fps=30.0)
    assert len(peaks) > 0
    assert all(f >= 0 for f in peaks)
