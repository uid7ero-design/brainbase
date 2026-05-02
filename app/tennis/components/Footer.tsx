export default function Footer() {
  return (
    <footer className="border-t border-white/6 bg-[#0a0a0a] py-10 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <span className="font-bold text-lg tracking-tight text-white">LD <span className="text-green-500">Tennis</span></span>
        <p className="text-zinc-600 text-sm text-center">© {new Date().getFullYear()} LD Tennis Coaching. Southern Adelaide, SA.</p>
        <div className="flex items-center gap-4">
          <a href="mailto:lukedoughtytennis@outlook.com" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">lukedoughtytennis@outlook.com</a>
          <a href="https://www.facebook.com/profile.php?id=61582192363700" target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-300 transition-colors" aria-label="Facebook">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
