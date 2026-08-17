import { AppShell } from '../../components/app/app-shell';

export default function AppLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <AppShell>{children}</AppShell>;
}