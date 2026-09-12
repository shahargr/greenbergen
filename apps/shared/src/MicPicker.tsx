"use client";

// THE MICROPHONE ROW, wherever a recorder lives.
//
// Only drawn when there is a choice to make - one microphone is not a
// decision - and it says which one is in use either way, because "did it use
// the USB one" should be a question the screen answers rather than one you
// have to ask afterwards.
export function MicPicker({ mics, micId, setMicId, micName, recording }: {
  mics: MediaDeviceInfo[];
  micId: string;
  setMicId: (id: string) => void;
  micName?: string;
  recording?: boolean;
}) {
  if (mics.length === 0) return null;
  if (mics.length === 1) {
    return mics[0]?.label
      ? <p className="tiny text-muted" style={{ margin: 0 }}>Recording on {mics[0].label}.</p>
      : null;
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <span className="tiny text-muted" style={{ flex: "none" }}>Microphone</span>
        <select className="input" value={micId} disabled={recording}
          onChange={(e) => setMicId(e.target.value)}
          style={{ minHeight: 36, fontSize: 13, padding: "4px 34px 4px 10px" }}>
          {mics.map((d, n) => (
            <option key={d.deviceId || n} value={d.deviceId}>{d.label || `Microphone ${n + 1}`}</option>
          ))}
        </select>
      </label>
      {recording && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          Recording on {micName ?? "the microphone above"}.
        </p>
      )}
    </div>
  );
}
