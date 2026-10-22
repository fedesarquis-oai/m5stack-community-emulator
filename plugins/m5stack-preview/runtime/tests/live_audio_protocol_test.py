#!/usr/bin/env python3
"""Exercise the real native worker's binary PCM and mixed reply framing.

Usage: python3 tests/live_audio_protocol_test.py /absolute/native-worker
Uses generated PCM only: no microphone, files of audio, or provider requests.
"""
import json
import math
import os
import select
import struct
import subprocess
import sys
import time


class Worker:
    def __init__(self, binary, profile="cores3se", app="custom"):
        self.process = subprocess.Popen(
            [binary, profile, app], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, bufsize=0,
        )
        self.initial = self.frame()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if self.process.poll() is None:
            self.process.kill()
        self.process.communicate(timeout=3)

    def read(self, size):
        data = bytearray()
        deadline = time.monotonic() + 3
        while len(data) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                raise AssertionError("Native response timed out")
            part = os.read(self.process.stdout.fileno(), size - len(data))
            assert part, "Native output closed unexpectedly"
            data.extend(part)
        return bytes(data)

    def line(self):
        line = bytearray()
        while True:
            char = self.read(1)
            if char == b"\n":
                return json.loads(line)
            line.extend(char)
            assert len(line) <= 16384, "Oversized JSON reply"

    def frame(self):
        header = self.line()
        assert "type" not in header, "Expected frame, got audio acknowledgment"
        pixels = self.read(header["width"] * header["height"] * 3)
        return header, pixels

    def send(self, command, data=b""):
        payload = command.encode("ascii") + b"\n" + data
        while payload:
            written = self.process.stdin.write(payload)
            assert written, "Native input closed"
            payload = payload[written:]

    def command(self, command):
        self.send(command)
        return self.frame()

    def audio(self, command, samples=()):
        self.send(command, struct.pack("<" + "h" * len(samples), *samples))
        ack = self.line()
        assert set(ack) == {"type", "profile", "app", "stream_id", "action", "accepted",
                            "sequence", "next_frame", "requested", "active"}, ack
        assert ack["type"] == "audio_ack"
        # There must be no framebuffer (or unsolicited second response) after ack.
        assert not select.select([self.process.stdout], [], [], 0.015)[0], "Audio emitted extra bytes"
        return ack

    def eof(self):
        self.process.stdin.close()
        self.process.stdin = None
        return self.process.wait(timeout=3)


def accepted(ack, value, sequence, frames, active):
    assert ack["accepted"] is value, ack
    assert (ack["sequence"], ack["next_frame"], ack["active"]) == (sequence, frames, active), ack


def run(binary):
    # Includes signed extrema, zero and newline bytes in binary; neither decoding
    # nor command framing can treat samples as text. Expected RMS is independent.
    pattern = [-32768, 32767, 0, 10, 16384, -16384, 2570, -2570]
    samples = pattern * 200
    rms = math.sqrt(sum((sample / 32768) ** 2 for sample in samples) / 1600)
    for profile in ("stickcplus2", "sticks3", "cores3", "cores3se"):
        with Worker(binary, profile) as worker:
            initial = worker.initial
            state = initial[0]["audio_input"]
            assert initial[0]["audio_input_adapter"] == 1
            assert state == {"requested": True, "active": False, "stream_id": None, "source": None,
                             "sequence": -1, "next_frame": 0, "received_frames": 0, "level": 0}, state
            accepted(worker.audio("audio_start stream fixture"), True, -1, 0, True)
            accepted(worker.audio("audio_chunk stream 0 0 1600", samples), True, 0, 1600, True)
            header, pixels = worker.command("state")
            state = header["audio_input"]
            assert state["received_frames"] == 1600 and abs(state["level"] - rms) < 1e-6, state
            assert state["source"] == "fixture" and header["count"] == 0
            assert pixels != initial[1], "App did not draw native PCM meter/count"
            for command in ("audio_chunk wrong 1 1600 1600", "audio_chunk stream 0 1600 1600",
                            "audio_chunk stream 2 1600 1600", "audio_chunk stream 1 1599 1600"):
                accepted(worker.audio(command, samples), False, 0, 1600, True)
                assert worker.command("state")[0]["audio_input"] == state
            primary = "button 50" if profile in ("stickcplus2", "sticks3") else "touch 160 120 50"
            assert worker.command(primary)[0]["count"] == 1
            accepted(worker.audio("audio_chunk stream 1 1600 3", [0, 0, 0]), True, 1, 1603, True)
            accepted(worker.audio("audio_chunk stream 2 1603 1", [1]), False, 1, 1603, True)
            accepted(worker.audio("audio_stop wrong"), False, 1, 1603, True)
            accepted(worker.audio("audio_stop stream"), True, 1, 1603, False)
            accepted(worker.audio("audio_stop stream"), True, 1, 1603, False)
            stopped = worker.command("state")[0]["audio_input"]
            assert stopped["received_frames"] == 1603 and stopped["level"] == 0
            accepted(worker.audio("audio_start stream fixture"), False, 1, 1603, False)
            accepted(worker.audio("audio_start second browser"), True, -1, 0, True)
            accepted(worker.audio("audio_chunk second 0 0 1600", samples), True, 0, 1600, True)
            reset = worker.command("reset")[0]
            assert reset["count"] == 0 and reset["audio_input"]["received_frames"] == 0
            assert not reset["audio_input"]["active"] and reset["audio_input"]["requested"]
            accepted(worker.audio("audio_chunk second 1 1600 1600", samples), False, 0, 1600, False)
            accepted(worker.audio("audio_start third browser"), True, -1, 0, True)
            hold = "button 1000" if profile in ("stickcplus2", "sticks3") else "touch 160 120 1000"
            assert not worker.command(hold)[0]["audio_input"]["active"]
            worker.send("quit")
            assert worker.eof() == 0
        print("PASS native binary PCM, callback RMS/count, ordered mixed replies and reset:", profile)

    for profile, app in (("atoms3r", "custom"), ("atoms3r", "counter")):
        with Worker(binary, profile, app) as worker:
            assert worker.initial[0]["audio_input"] is None
            assert "audio_input_adapter" not in worker.initial[0]
            accepted(worker.audio("audio_start absent fixture"), False, -1, 0, False)
            accepted(worker.audio("audio_chunk absent 0 0 1", [10]), False, -1, 0, False)
            assert worker.command("state")[0]["audio_input"] is None

    for command, data in (
        ("audio_chunk stream 0 0 0", b""), ("audio_chunk stream 0 0 1601", b""),
        ("audio_chunk stream -1 0 1", b""), ("audio_chunk stream 0 0 1 extra", b""),
        ("audio_chunk stream 0 0 2", b"\x00\x00\x00"),
        ("audio_start stream physical", b""), ("audio_stop bad/id", b""),
    ):
        with Worker(binary) as worker:
            worker.send(command, data)
            assert worker.eof() == 2, "Malformed audio framing was accepted"
    for app in ("trail", "mascot", "eightball"):
        result = subprocess.run([binary, "cores3se", app], capture_output=True, timeout=3)
        assert result.returncode != 0 and not result.stdout, "Retired app was exposed"
    print("PASS no-mic and retired-app exclusion, exact binary length, bounded parsing and clean exits")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    run(os.path.abspath(sys.argv[1]))
