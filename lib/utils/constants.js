export const GLASS = {
  background: "rgba(10,13,22,0.55)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.06)",
};

export const GLASS_LIGHT = {
  background: "rgba(14,18,30,0.40)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.05)",
};

export const CYAN = "#00CFEA";

export const NEBULA = [
  "radial-gradient(ellipse 65% 52% at 42% 52%,rgba(0,175,215,.082) 0%,transparent 62%)",
  "radial-gradient(ellipse 40% 40% at 76% 18%,rgba(80,50,240,.055) 0%,transparent 65%)",
  "radial-gradient(ellipse 48% 30% at 14% 76%,rgba(0,140,195,.042) 0%,transparent 65%)",
  "radial-gradient(ellipse 28% 44% at 62% 68%,rgba(0,95,175,.035) 0%,transparent 65%)",
].join(",");

export const KEYFRAMES = `
  @keyframes nebulaBreath{0%{opacity:.85;transform:scale(1)}100%{opacity:1;transform:scale(1.05)}}
  @keyframes dotPulse{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(2.4);opacity:0}}
  @keyframes micRipple{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.9);opacity:0}}
  @keyframes chatSlideUp{from{opacity:0;transform:translateX(-50%) translateY(16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  @keyframes cardEntry{from{opacity:0;transform:translateX(-18px) rotateX(8deg)}to{opacity:1;transform:translateX(0) rotateX(0deg)}}
  @keyframes cardFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  @keyframes slideInRight{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
  @keyframes agentPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}
  *{box-sizing:border-box}
  button{font-family:inherit;outline:none;cursor:pointer}
  ::-webkit-scrollbar{width:3px}
  ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}
`;
