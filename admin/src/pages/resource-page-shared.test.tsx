import { render, screen, waitFor } from '@testing-library/react';
import { Modal } from './resource-page-shared';

describe('resource modal accessibility', () => {
  it('respeta el foco solicitado antes del botón de cierre', async () => {
    render(
      <Modal title="Biblioteca" onClose={() => undefined}>
        <input autoFocus aria-label="Buscar archivo" />
      </Modal>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Buscar archivo' }),
      ).toHaveFocus();
    });
  });
});
