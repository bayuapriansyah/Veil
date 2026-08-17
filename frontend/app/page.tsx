import { Nav } from '../components/landing/nav';
import { Hero } from '../components/landing/hero';
import { StatusStrip } from '../components/landing/status-strip';
import { Problem } from '../components/landing/problem';
import { Solution } from '../components/landing/solution';
import { HowItWorks } from '../components/landing/how-it-works';
import { LiveVerificationFlow } from '../components/landing/live-flow';
import { Privacy } from '../components/landing/privacy';
import { CanvasSection } from '../components/landing/canvas-section';
import { Architecture } from '../components/landing/architecture';
import { Features } from '../components/landing/features';
import { Security } from '../components/landing/security';
import { Cta } from '../components/landing/cta';
import { Footer } from '../components/landing/footer';

export default function LandingPage(): React.ReactElement {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <StatusStrip />
        <Problem />
        <Solution />
        <HowItWorks />
        <LiveVerificationFlow />
        <Privacy />
        <CanvasSection />
        <Architecture />
        <Features />
        <Security />
        <Cta />
      </main>
      <Footer />
    </>
  );
}