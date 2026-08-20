import { Nav } from '../components/landing/nav';
import { Hero } from '../components/landing/hero';
import { LedgerWitness } from '../components/landing/ledger';
import { Features } from '../components/landing/features';
import { Cta } from '../components/landing/cta';
import { Footer } from '../components/landing/footer';

export default function LandingPage(): React.ReactElement {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <LedgerWitness />
        <Features />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
