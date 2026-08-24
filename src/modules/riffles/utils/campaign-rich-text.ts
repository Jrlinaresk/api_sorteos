import * as sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'a',
  'img',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

/**
 * Canonicaliza HTML editorial antes de guardarlo o calcular su hash legal.
 * No se permiten estilos, clases, IDs, SVG, embeds, formularios ni handlers.
 */
export function sanitizeCampaignRichText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      a: ['https', 'mailto', 'tel'],
      img: ['https'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    parseStyleAttributes: false,
    transformTags: {
      a: (tagName, attributes) => {
        const transformed = { ...attributes };
        if (transformed.target === '_blank') {
          transformed.rel = 'noopener noreferrer';
        } else {
          delete transformed.target;
          delete transformed.rel;
        }
        return { tagName, attribs: transformed };
      },
      img: (tagName, attributes) => {
        const transformed = { ...attributes };
        if (!/^\d{1,4}$/.test(transformed.width ?? '')) {
          delete transformed.width;
        }
        if (!/^\d{1,4}$/.test(transformed.height ?? '')) {
          delete transformed.height;
        }
        if (!['lazy', 'eager'].includes(transformed.loading ?? '')) {
          delete transformed.loading;
        }
        return { tagName, attribs: transformed };
      },
    },
  }).trim();
}
