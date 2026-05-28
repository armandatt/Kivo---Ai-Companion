interface AspirationAnchorProps {
  words: string[]
}

export default function AspirationAnchor({ words }: AspirationAnchorProps) {
  if (!words.length) return null

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        pointerEvents: "none",
        zIndex: 0,
        height: "110px",
        overflow: "hidden",
      }}
    >
      <p
        style={{
          fontSize: "72px",
          fontWeight: 900,
          color: "#FFFFFF",
          opacity: 0.15,
          margin: 0,
          lineHeight: 1.1,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          userSelect: "none",
        }}
      >
        {words.join("  ·  ")}
      </p>
    </div>
  )
}
