import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, ErrorState, Pagination, StatusBadge } from './ui';
import { ApiError } from '@/lib/api';

describe('admin UI primitives', () => {
  it('presenta el estado con texto, no solo color', () => {
    render(<StatusBadge status="paid" />);
    expect(screen.getByText('Pagado')).toBeVisible();
  });

  it('muestra la referencia de correlación de un error de API', () => {
    render(
      <ErrorState
        error={
          new ApiError(409, {
            message: 'La campaña cambió',
            correlationId: 'corr-123',
          })
        }
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('La campaña cambió');
    expect(screen.getByText('Referencia: corr-123')).toBeVisible();
  });

  it('bloquea una acción destructiva hasta escribir la frase exacta', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <ConfirmDialog
        open
        danger
        title="Purgar archivo"
        description="Esta acción no se puede deshacer."
        confirmationText="PURGAR"
        onClose={() => undefined}
        onConfirm={confirm}
      />,
    );
    const button = screen.getByRole('button', { name: 'Confirmar' });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'PURGAR');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('no permite avanzar más allá de la última página', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <Pagination page={3} totalPages={3} total={52} onPageChange={change} />,
    );
    expect(
      screen.getByRole('button', { name: 'Página siguiente' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(change).toHaveBeenCalledWith(2);
  });
});
