import { usePreferences, setTheme } from './preferences';
import { Children, isValidElement, type ReactNode } from 'react';
import MuiButton, { type ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { dark, light, ThemeProvider } from 'decentraland-ui2/dist/theme';
import GlobalStyles from '@mui/material/GlobalStyles';

export const useThemeChoice = () => {
  const { theme } = usePreferences();
  return { choice: theme, setChoice: setTheme };
};
// Shared theme with the landing and documentation.
export function StudioTheme({ children }: { children: ReactNode }) {
  const { theme: choice } = usePreferences();
  const selected = choice === 'dark' ? dark : light;
  const palette =
    choice === 'dark' ? dark.colorSchemes.dark!.palette : light.colorSchemes.light!.palette;
  return (
    <>
      <ThemeProvider theme={selected}>
        <GlobalStyles
          styles={{
            ':root': {
              '--primary': palette.primary.main,
              '--panel': palette.background.paper,
              '--background': palette.background.default,
              '--text': palette.text.primary,
              '--muted': palette.text.secondary,
              '--secondary-text': palette.text.secondary,
              '--line': palette.divider,
            },
          }}
        />
        {children}
      </ThemeProvider>
    </>
  );
}

export function Button({
  primary,
  basic,
  fluid,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps & { primary?: boolean; basic?: boolean; fluid?: boolean; loading?: boolean }) {
  return (
    <MuiButton
      {...props}
      variant={primary ? 'contained' : basic ? 'outlined' : 'text'}
      fullWidth={fluid}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
      sx={{ minHeight: 44, textTransform: 'none', ...props.sx }}
    >
      {children}
    </MuiButton>
  );
}

function StudioDialog({
  open,
  onClose,
  children,
  size,
}: {
  open: boolean;
  onClose: () => void;
  size?: 'small' | 'large';
  children: ReactNode;
}) {
  const title = Children.toArray(children).find(
    (child) => isValidElement(child) && child.type === DialogTitle,
  );
  const label = isValidElement<{ children: ReactNode }>(title)
    ? String(title.props.children)
    : undefined;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={size === 'large' ? 'lg' : 'sm'}
      aria-label={label}
      PaperProps={{
        className: 'studio-dialog',
        sx:
          size === 'small' ? { maxWidth: 480 } : size === 'large' ? { maxWidth: 1320 } : undefined,
      }}
    >
      {children}
    </Dialog>
  );
}
// Preserve a single accessible name and MUI focus trapping for both dialogs.
export const Modal = Object.assign(StudioDialog, {
  Header: DialogTitle,
  Content: DialogContent,
  Actions: DialogActions,
});
