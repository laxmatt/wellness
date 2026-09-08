import Link from "next/link";
import { Container, Shell } from "@/components/site/Shell";
import { categories } from "@/domain/categories";

export default function NotFound() {
  return (
    <Shell tray={false}>
      <Container className="pt-16">
        <p className="eyebrow">404</p>
        <h1 className="font-display mt-2 text-5xl leading-none">Nothing here.</h1>
        <p className="mt-3 max-w-md text-lg text-ink-soft">The page moved or never existed. The categories are one tap away.</p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/${c.slug}`} className="tap inline-flex items-center rounded-pill bg-ink px-5 text-sm font-semibold text-paper hover:bg-ember-deep">
                {c.navLabel}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </Shell>
  );
}
