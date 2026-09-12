"use client";

import { useCallback, useEffect, useState } from "react";

// WHICH MICROPHONE, on every recorder.
//
// Shahar (2026-09-12), after the same fix landed on one of them: "you already
// mentioned that you will get the opportunity to select microphone when
// working on a computer with more than one microphone. you failed to do this
// across all screens?"
//
// He is right - it was fixed in Evidence and nowhere else, and there are four
// recorders in this codebase. This is the rule in one place so that cannot
// happen again: list the inputs, remember the choice, and always be able to
// say which one is being used.
//
// The browser picks the system default, which on a Mac is usually the built-in
// one even with a USB mic plugged in, and it never says so. Device LABELS stay
// empty until microphone permission has been granted at least once, which is
// why the list is read again the moment a recording starts.
export function useMicrophones() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");

  const read = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices();
      const ins = (all ?? []).filter((d) => d.kind === "audioinput");
      setMics(ins);
      setMicId((cur) => (cur && ins.some((d) => d.deviceId === cur) ? cur : ins[0]?.deviceId ?? ""));
    } catch { /* no permission yet, or no API: the system default is used */ }
  }, []);

  useEffect(() => {
    void read();
    navigator.mediaDevices?.addEventListener?.("devicechange", read);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", read);
  }, [read]);

  // What to hand getUserMedia. An empty choice means "whatever the system
  // says", which is the right answer on a phone and the only answer before
  // permission has been granted.
  const constraint: MediaStreamConstraints["audio"] = micId ? { deviceId: { exact: micId } } : true;
  const micName = mics.find((d) => d.deviceId === micId)?.label || undefined;

  return { mics, micId, setMicId, constraint, micName, read };
}
