import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="not-found">
      <SearchX aria-hidden="true" />
      <p className="eyebrow">Error 404</p>
      <h1>Esta pantalla no existe</h1>
      <p>
        El enlace puede estar desactualizado o no pertenecer a tu nivel de
        acceso.
      </p>
      <Link className="button button--primary" to="/">
        <ArrowLeft size={17} aria-hidden="true" /> Volver al resumen
      </Link>
    </section>
  );
}
