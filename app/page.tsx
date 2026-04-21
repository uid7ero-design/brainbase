"use client";

import { useState } from "react";

export default function Home() {
  const [website, setWebsite] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");

  const steps = [
    {
      title: "Connect your business",
      text: "Add your website, documents, emails, and tools.",
      icon: "01",
    },
    {
      title: "Build your brain",
      text: "BrainBase structures your knowledge into one intelligent system.",
      icon: "02",
    },
    {
      title: "Put it to work",
      text: "Ask questions, generate work, track activity, and automate tasks.",
      icon: "03",
    },
  ];

  const features = [
    {
      title: "AI Brain",
      text: "Understands your business, services, documents, and workflows.",
    },
    {
      title: "Smart Memory",
      text: "Retains context so your assistant improves over time.",
    },
    {
      title: "Dashboards",
      text: "See operations, tasks, insights, and business health at a glance.",
    },
    {
      title: "Automations",
      text: "Turn repeated work into repeatable systems.",
    },
    {
      title: "Integrations",
      text: "Connect email, docs, calendars, and internal tools.",
    },
    {
      title: "Insights",
      text: "Surface what matters and what to do next.",
    },
  ];

  const dashboardTabs = ["Overview", "Tasks", "Insights", "Assistant"];

  const handleScan = () => {
    if (!website.trim()) return;

    setIsScanning(true);
    setHasScanned(false);

    setTimeout(() => {
      setIsScanning(false);
      setHasScanned(true);
    }, 2200);
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.10),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.10),transparent_28%)]" />

      <section className="mx-auto max-w-7xl px-6 pt-6">
        <header className="sticky top-4 z-40 flex items-center justify-between rounded-full border border-slate-200/80 bg-white/90 px-5 py-3 shadow-sm backdrop-blur">
          <div className="text-lg font-semibold tracking-tight">BrainBase</div>

          <nav className="hidden gap-8 text-sm text-slate-600 md:flex">
            <a href="#how-it-works" className="transition hover:text-slate-900">
              How it works
            </a>
            <a href="#dashboard" className="transition hover:text-slate-900">
              Dashboard
            </a>
            <a href="#features" className="transition hover:text-slate-900">
              Features
            </a>
            <a href="#pricing" className="transition hover:text-slate-900">
              Pricing
            </a>
          </nav>

          <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition duration-300 hover:opacity-90">
            Start Free
          </button>
        </header>
      </section>

      <section className="mx-auto grid max-w-7xl items-center gap-16 px-6 pb-28 pt-20 lg:grid-cols-2 lg:pt-28">
        <div>
          <div className="mb-4 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
            Your business’s Jarvis
          </div>

          <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
            Build your business a brain.
          </h1>

          <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
            Knows your business. Tracks your work. Tells you what to do next.
          </p>

          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-500">
            BrainBase combines an AI assistant, executive dashboards, memory,
            and workflows into one system built to understand and run your
            business.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <button className="rounded-xl bg-slate-900 px-6 py-3 font-medium text-white shadow-lg shadow-slate-900/10 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:opacity-95">
              Start Free
            </button>

            <button
              onClick={() => setShowDemo(true)}
              className="rounded-xl border border-slate-200 bg-white px-6 py-3 font-medium text-slate-700 shadow-sm transition duration-300 hover:bg-slate-50"
            >
              See Demo
            </button>
          </div>

          <div className="mt-8 max-w-2xl rounded-3xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60">
            <label className="mb-3 block text-sm font-medium text-slate-700">
              Scan your business website
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                placeholder="Enter your website URL"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={handleScan}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition duration-300 hover:opacity-95"
              >
                Scan Business
              </button>
            </div>

            {!isScanning && !hasScanned && (
              <p className="mt-3 text-sm text-slate-500">
                Try: yourbusiness.com
              </p>
            )}

            {isScanning && (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-500" />
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500 [animation-delay:150ms]" />
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-500 [animation-delay:300ms]" />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Scanning site structure, business content, and AI readiness...
                </p>
              </div>
            )}

            {hasScanned && !isScanning && (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">AI Readiness</div>
                    <div className="mt-1 text-3xl font-semibold">78%</div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Business Clarity</div>
                    <div className="mt-1 text-3xl font-semibold">64%</div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Automation Potential</div>
                    <div className="mt-1 text-3xl font-semibold">High</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Business Summary</div>
                  <p className="mt-2 text-sm leading-7 text-slate-700">
                    Your website presents core services but lacks structured
                    information for AI systems. Key business processes appear
                    manual and not fully systemised.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Key Gaps Identified</div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    <li className="rounded-xl bg-slate-50 p-3">
                      Missing structured service descriptions
                    </li>
                    <li className="rounded-xl bg-slate-50 p-3">
                      No clear FAQ or knowledge base
                    </li>
                    <li className="rounded-xl bg-slate-50 p-3">
                      Limited automation across workflows
                    </li>
                    <li className="rounded-xl bg-slate-50 p-3">
                      No connected business systems detected
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Opportunities</div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Build a central business knowledge base
                    </li>
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Automate recurring reporting and admin tasks
                    </li>
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Implement AI-driven customer response workflows
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl bg-slate-900 p-4 text-white">
                  <div className="text-sm opacity-70">Recommended next step</div>
                  <div className="mt-2 text-sm">
                    Connect your email, documents, and workflows to build your
                    full BrainBase system.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold">78%</div>
              <div className="mt-1 text-sm text-slate-500">AI readiness</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold">42</div>
              <div className="mt-1 text-sm text-slate-500">Active tasks</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold">6</div>
              <div className="mt-1 text-sm text-slate-500">Key alerts</div>
            </div>
          </div>
        </div>

        <div id="dashboard" className="relative">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-200/70">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-500">
                  BrainBase Overview
                </div>
                <div className="text-xl font-semibold">Executive Dashboard</div>
              </div>

              <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                System healthy
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {dashboardTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition duration-300 ${
                    activeTab === tab
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === "Overview" && (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Business health</div>
                    <div className="mt-2 text-3xl font-semibold">91</div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div className="h-2 w-[91%] rounded-full bg-slate-900" />
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Open workflows</div>
                    <div className="mt-2 text-3xl font-semibold">14</div>
                    <div className="mt-2 text-sm text-amber-600">
                      3 need attention today
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">AI actions today</div>
                    <div className="mt-2 text-3xl font-semibold">127</div>
                    <div className="mt-2 text-sm text-emerald-600">
                      +18% from yesterday
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-500">Performance</div>
                        <div className="font-semibold">
                          Task and workflow trend
                        </div>
                      </div>
                      <div className="text-sm text-slate-400">Last 30 days</div>
                    </div>

                    <div className="flex h-48 items-end gap-3">
                      {[48, 62, 55, 74, 68, 86, 78, 92, 88, 96, 84, 99].map(
                        (h, i) => (
                          <div
                            key={i}
                            className="flex flex-1 flex-col justify-end"
                          >
                            <div
                              className="rounded-t-xl bg-gradient-to-t from-slate-900 to-indigo-500"
                              style={{ height: `${h}%` }}
                            />
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Snapshot</div>
                    <div className="mt-1 font-semibold">Current priorities</div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                        Weekly reporting can be automated.
                      </div>
                      <div className="rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-900">
                        Customer response times need review.
                      </div>
                      <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                        Document gaps found in onboarding and FAQ content.
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "Tasks" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Open tasks</div>
                  <div className="mt-3 space-y-3">
                    {[
                      "Approve weekly operations report",
                      "Follow up with 2 overdue clients",
                      "Review automation setup",
                      "Update FAQ content",
                    ].map((task) => (
                      <div
                        key={task}
                        className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700"
                      >
                        {task}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Task summary</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-2xl font-semibold">42</div>
                      <div className="text-sm text-slate-500">Active</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-2xl font-semibold">8</div>
                      <div className="text-sm text-slate-500">Overdue</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-2xl font-semibold">11</div>
                      <div className="text-sm text-slate-500">Automatable</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-2xl font-semibold">23</div>
                      <div className="text-sm text-slate-500">Done today</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Insights" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Top insights</div>
                  <ul className="mt-3 space-y-3 text-sm text-slate-700">
                    <li className="rounded-xl bg-slate-50 p-3">
                      Repeated manual reporting detected across 4 teams.
                    </li>
                    <li className="rounded-xl bg-slate-50 p-3">
                      Customer response times slipped 12% this week.
                    </li>
                    <li className="rounded-xl bg-slate-50 p-3">
                      Knowledge gaps found in onboarding documents.
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">
                    Recommended actions
                  </div>
                  <ul className="mt-3 space-y-3 text-sm text-slate-700">
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Automate weekly status reports.
                    </li>
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Create a standard reply workflow for common enquiries.
                    </li>
                    <li className="rounded-xl bg-indigo-50 p-3 text-indigo-900">
                      Expand service FAQs on your website.
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {activeTab === "Assistant" && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500">AI assistant</div>
                <div className="mt-1 font-semibold">
                  What should I focus on?
                </div>

                <div className="mt-4 space-y-3">
                  <div className="max-w-[85%] rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                    What are my biggest issues today?
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-900">
                    You have 3 overdue tasks, 2 missing follow-ups, and one
                    repeated reporting process that should be automated.
                  </div>
                  <div className="max-w-[85%] rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
                    Can you help with that?
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-900">
                    Yes. I can draft updates, assign tasks, and prepare an
                    automation workflow.
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500">Connected systems</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Gmail", "Drive", "Calendar", "Slack", "CRM", "Docs"].map(
                    (tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {tool}
                      </span>
                    )
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500">System note</div>
                <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  6 integrations active and ready for automation.
                </div>
              </div>
            </div>
          </div>

          <div className="absolute -left-6 top-10 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:block">
            <div className="text-sm text-slate-500">AI readiness</div>
            <div className="text-2xl font-semibold">78%</div>
          </div>

          <div className="absolute -bottom-6 right-8 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:block">
            <div className="text-sm text-slate-500">Next recommendation</div>
            <div className="text-sm font-medium">
              Automate weekly reporting
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            How it works
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            Build your business brain in three steps.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Connect your systems, structure your knowledge, and let BrainBase
            guide your next move.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition duration-300 hover:-translate-y-1.5 hover:shadow-xl"
            >
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-semibold text-white">
                {step.icon}
              </div>
              <h3 className="text-xl font-semibold">{step.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Features
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight">
            A complete operating layer for modern businesses.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            More than a chatbot. BrainBase combines memory, dashboards, AI
            assistance, and workflows in one premium system.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition duration-300 hover:-translate-y-1.5 hover:shadow-xl"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-400 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <h3 className="text-xl font-semibold">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Pricing
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            Simple pricing for growing businesses.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Start free, then scale into a full business brain with dashboards,
            memory, and automation.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Free</div>
            <div className="mt-3 text-4xl font-semibold">$0</div>
            <div className="mt-2 text-slate-500">
              Perfect for exploring BrainBase
            </div>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              <li>1 business scan</li>
              <li>Dashboard preview</li>
              <li>Basic assistant demo</li>
              <li>Limited insights</li>
            </ul>
            <button className="mt-8 w-full rounded-xl border border-slate-200 px-5 py-3 font-medium text-slate-700 transition duration-300 hover:bg-slate-50">
              Start Free
            </button>
          </div>

          <div className="relative rounded-3xl border border-slate-900 bg-slate-900 p-8 text-white shadow-xl">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-500 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              Most Popular
            </div>
            <div className="text-sm font-medium text-slate-300">Pro</div>
            <div className="mt-3 text-4xl font-semibold">$79</div>
            <div className="mt-2 text-slate-300">per month</div>
            <ul className="mt-6 space-y-3 text-sm text-slate-200">
              <li>Full business brain</li>
              <li>Executive dashboards</li>
              <li>Smart memory</li>
              <li>Workflow automations</li>
              <li>Integrations</li>
              <li>AI recommendations</li>
            </ul>
            <button className="mt-8 w-full rounded-xl bg-white px-5 py-3 font-medium text-slate-900 transition duration-300 hover:bg-slate-100">
              Start Pro
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Enterprise</div>
            <div className="mt-3 text-4xl font-semibold">Custom</div>
            <div className="mt-2 text-slate-500">
              For teams and complex operations
            </div>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              <li>Multi-team setup</li>
              <li>Custom dashboards</li>
              <li>Advanced automations</li>
              <li>Priority support</li>
              <li>Implementation assistance</li>
            </ul>
            <button className="mt-8 w-full rounded-xl border border-slate-200 px-5 py-3 font-medium text-slate-700 transition duration-300 hover:bg-slate-50">
              Contact Sales
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="rounded-[32px] bg-slate-900 px-8 py-16 text-center text-white shadow-2xl shadow-slate-300 sm:px-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Turn your business into an AI-powered system.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Build a brain for your business with dashboards, memory, and an
              assistant that helps you stay ahead.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <button className="rounded-xl bg-white px-6 py-3 font-medium text-slate-900 transition duration-300 hover:bg-slate-100">
                Start Free
              </button>
              <button
                onClick={() => setShowDemo(true)}
                className="rounded-xl border border-slate-700 px-6 py-3 font-medium text-white transition duration-300 hover:bg-slate-800"
              >
                See Demo
              </button>
            </div>
          </div>
        </div>
      </section>

      {showDemo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <button
              onClick={() => setShowDemo(false)}
              className="absolute right-4 top-4 text-slate-400 transition hover:text-slate-700"
            >
              ✕
            </button>

            <h2 className="mb-2 text-2xl font-semibold">BrainBase Demo</h2>
            <p className="mb-6 text-sm text-slate-500">
              A preview of how BrainBase understands your business and helps
              take action.
            </p>

            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500">Live business summary</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-2xl font-semibold">78%</div>
                    <div className="text-sm text-slate-500">AI readiness</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-2xl font-semibold">4</div>
                    <div className="text-sm text-slate-500">Key gaps</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-2xl font-semibold">42</div>
                    <div className="text-sm text-slate-500">Active tasks</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-2xl font-semibold">6</div>
                    <div className="text-sm text-slate-500">Alerts</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500">AI Assistant</div>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="max-w-[85%] rounded-xl bg-slate-100 p-3 text-slate-700">
                    What should I focus on today?
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-xl bg-indigo-50 p-3 text-indigo-900">
                    You have 3 overdue tasks, 2 missing follow-ups, and a
                    reporting process that should be automated.
                  </div>
                  <div className="max-w-[85%] rounded-xl bg-slate-100 p-3 text-slate-700">
                    Can you help fix that?
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-xl bg-indigo-50 p-3 text-indigo-900">
                    Yes. I can assign tasks, draft responses, and automate
                    reporting workflows.
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition duration-300 hover:opacity-95">
                Start Free
              </button>
              <button
                onClick={() => setShowDemo(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 transition duration-300 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}