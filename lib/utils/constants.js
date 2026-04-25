export const BG      = "#05070A";
export const SURFACE = "rgba(5,7,10,.92)";
export const CARD    = "rgba(255,255,255,.03)";
export const BORDER  = "rgba(255,255,255,.08)";
export const BORDER_SUBTLE = "rgba(255,255,255,.04)";

export const T1 = "rgba(230,237,243,.92)";
export const T2 = "rgba(122,133,153,.90)";
export const T3 = "rgba(255,255,255,.28)";

export const CYAN = "#7C3AED";
export const VIOLET      = "#7C3AED";
export const VIOLET_SOFT = "#A78BFA";

export const GLASS = {
  background: 'rgba(6,5,12,.86)',
  border: '1px solid rgba(255,255,255,.08)',
};

export const GLASS_LIGHT = {
  background: 'rgba(255,255,255,.025)',
  border: '1px solid rgba(255,255,255,.05)',
};

// CSS spotlight — layered over the Three.js backdrop for the outer viewport edge
export const NEBULA = "radial-gradient(ellipse 38% 24% at 50% 40%, rgba(70,15,140,0.10) 0%, transparent 58%)";

export const KEYFRAMES = `
  @keyframes dotPulse{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(2.0);opacity:0}}
  @keyframes micRipple{0%{transform:scale(1);opacity:.4}100%{transform:scale(1.6);opacity:0}}
  @keyframes chatSlideUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  @keyframes cardEntry{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes cardFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes slideInRight{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:translateX(0)}}
  @keyframes agentPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(1.12)}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  *{box-sizing:border-box}
  html,body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
  button{font-family:inherit;outline:none;cursor:pointer}
  ::-webkit-scrollbar{width:3px}
  ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}
`;
