import { MarketingNav } from '@/components/marketing/MarketingNav';
import { Footer } from '@/components/marketing/Footer';
import { ButtonLink, Container, PageIntro } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <>
      <MarketingNav />
      <main id="main">
        <Container className="py-20">
          <PageIntro eyebrow="404" title="That page is not here." lede="The link may be out of date, or the page has not been built yet." />
          <div className="mt-8">
            <ButtonLink href="/">Back to home</ButtonLink>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
