import { sanitizeCampaignRichText } from './campaign-rich-text';

describe('sanitizeCampaignRichText', () => {
  it('descarta scripts, embeds, estilos, handlers y protocolos activos', () => {
    const result = sanitizeCampaignRichText(`
      <script>alert('x')</script>
      <style>body{display:none}</style>
      <iframe src="https://evil.test"></iframe>
      <p class="hero" style="color:red" onclick="steal()">Reglas</p>
      <a href="javascript:alert(1)" target="_blank">mal</a>
      <img src="data:image/svg+xml,x" onerror="steal()">
    `);

    expect(result).toContain('<p>Reglas</p>');
    expect(result).not.toMatch(
      /script|style|iframe|onclick|onerror|javascript:|data:|class=/i,
    );
  });

  it('conserva estructura editorial, enlaces seguros y medios HTTPS', () => {
    const result = sanitizeCampaignRichText(`
      <h2>Premio</h2>
      <p><strong>Titan 160</strong> o R$ 15 mil.</p>
      <a href="https://example.test/reglas" target="_blank">Reglas</a>
      <a href="/privacidad">Privacidad</a>
      <img src="https://cdn.example.test/titan.webp" alt="Moto" width="1200" loading="lazy">
    `);

    expect(result).toContain('<h2>Premio</h2>');
    expect(result).toContain('<strong>Titan 160</strong>');
    expect(result).toContain(
      'href="https://example.test/reglas" target="_blank" rel="noopener noreferrer"',
    );
    expect(result).toContain('href="/privacidad"');
    expect(result).toContain(
      'src="https://cdn.example.test/titan.webp" alt="Moto" width="1200" loading="lazy"',
    );
  });

  it('normaliza de forma idempotente el HTML que se usará para el hash', () => {
    const first = sanitizeCampaignRichText(
      '<p style="color:red">Texto <b>legal</b></p>',
    );
    expect(sanitizeCampaignRichText(first)).toBe(first);
  });
});
