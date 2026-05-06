import LeadForm from './LeadForm'

const services = [
  {
    icon: '🎾',
    title: 'Private Lessons',
    description: 'One-on-one coaching tailored to your level — beginner through to advanced.',
  },
  {
    icon: '👥',
    title: 'Group Clinics',
    description: 'Small group sessions to develop technique and match play in a fun environment.',
  },
  {
    icon: '📈',
    title: 'Match Analysis',
    description: 'Video review and tactical breakdowns to sharpen your competitive game.',
  },
]

export default function TennisPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <span className="text-xl font-bold tracking-tight">LD Tennis</span>
        <a
          href="#contact"
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Get in Touch
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-green-50 text-green-700 text-sm font-medium px-3 py-1 rounded-full mb-6">
          Professional Tennis Coaching · Sydney
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
          Elevate your game<br />
          <span className="text-green-600">on and off the court</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10">
          Whether you&apos;re picking up a racket for the first time or looking to compete at a higher level,
          LD Tennis provides expert coaching that gets results.
        </p>
        <a
          href="#contact"
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors"
        >
          Book a Free Consultation
        </a>
      </section>

      {/* Services */}
      <section className="bg-gray-50 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">What we offer</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {services.map(s => (
              <div key={s.title} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="text-3xl mb-4">{s.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lead Form */}
      <section id="contact" className="py-20 px-6">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Ready to start?</h2>
            <p className="text-gray-500">Fill in the form and we&apos;ll get back to you within 24 hours.</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-8">
            <LeadForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} LD Tennis · ldtennis.com.au
      </footer>
    </main>
  )
}
