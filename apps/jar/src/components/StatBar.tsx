// Mood/energy bar (W2 · Critter card, SCREENS.md): "Mood (green > 60,
// amber > 35, red) and Energy."
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

interface StatBarProps {
  label: string;
  value: number; // 0-100
  colorByValue?: boolean;
}

function moodColor(value: number): string {
  if (value > 60) return '#4caf50';
  if (value > 35) return '#e0a020';
  return '#d1453b';
}

export function StatBar({ label, value, colorByValue = false }: StatBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = colorByValue ? moodColor(clamped) : 'var(--jar-accent, #3a8dde)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 56 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 999,
          background: 'rgba(0, 0, 0, 0.12)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${clamped}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}
