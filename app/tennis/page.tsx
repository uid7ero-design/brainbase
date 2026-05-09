import Nav from "./components/Nav";
import BouncingLogo from "./components/BouncingLogo";
import Hero from "./components/Hero";
import About from "./components/About";
import Positioning from "./components/Positioning";
import Coaching from "./components/Coaching";
import HowItWorks from "./components/HowItWorks";
import Location from "./components/Location";
import BookingForm from "./components/BookingForm";
import BlogSection from "./components/BlogSection";
import Footer from "./components/Footer";

export const metadata = {
  title: "LD Tennis Coaching – Private Lessons for All Ages",
  description: "Beginner & entry-level tennis programs for all ages 4+ with Head Coach Luke Doughty. Build confidence, skills, and love for the game.",
};

const LD_ORG = process.env.LD_TENNIS_ORG_ID ?? '';

export default function TennisPage() {
  return (
    <>
      <Nav />
      <BouncingLogo />
      <main>
        <Hero />
        <About />
        <Positioning />
        <Coaching />
        <HowItWorks />
        <Location />
        {LD_ORG && <BlogSection orgId={LD_ORG} />}
        <BookingForm />
      </main>
      <Footer />
    </>
  );
}
