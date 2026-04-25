'use client';

import React from 'react';

export interface DashboardGridProps {
  left:        React.ReactNode;
  right:       React.ReactNode;
  gap?:        number;
  rightWidth?: number;
}

export default function DashboardGrid({ left, right, gap = 16, rightWidth = 252 }: DashboardGridProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `1fr ${rightWidth}px`, gap, alignItems: 'start' }}>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}
