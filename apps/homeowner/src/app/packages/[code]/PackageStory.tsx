import type { PageSection } from "@shared/catalogue";

// THE MIDDLE OF THE PAGE, and the end of it.
//
// Shahar (2026-09-11) pointed at starlink.com for the shape of a package
// page. The half of that shape we did not have is this: a run of bands that
// each make ONE point in a headline and a line or two, and then the questions
// people actually ask, answered plainly. Both come out of one table
// (blueprint_package_sections, migration 067), so a package with nothing
// written for it renders the same page with these bands simply absent.
//
// No image of its own is not a failure. A claim is a sentence worth reading;
// when there is a picture for it, it runs full width above the words.

export function Claims({ sections }: { sections: PageSection[] }) {
  const claims = sections.filter((s) => s.kind === "claim");
  if (claims.length === 0) return null;
  return (
    <section className="claims">
      {claims.map((c, i) => (
        <div className="claim" key={i}>
          {c.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.image_url} alt="" loading="lazy" />
          )}
          <h2>{c.headline}</h2>
          {c.body && <p>{c.body}</p>}
        </div>
      ))}
    </section>
  );
}

export function Faq({ sections }: { sections: PageSection[] }) {
  const faqs = sections.filter((s) => s.kind === "faq");
  if (faqs.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="divider-label">Questions people ask</div>
      {faqs.map((f, i) => (
        <details className="faq" key={i}>
          <summary>
            <span>{f.headline}</span>
            <span className="mark" aria-hidden />
          </summary>
          {f.body && <p>{f.body}</p>}
        </details>
      ))}
    </section>
  );
}
