import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Card, Unavailable } from '@/components/ui/primitives';
import { product } from '@/config/product';

export default function OrganiserSettingsPage() {
  return (
    <OrganiserShell title="Settings">
      <div className="grid gap-6 lg:grid-cols-2">
        <Unavailable
          title="Organiser settings are not connected"
          detail="Organisation name and branding, support contact, email sender identity and team members will live here. Nothing can be edited until an account exists."
        />
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Product identity (read-only)</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-eve-muted">Product</dt><dd>{product.name}</dd>
            <dt className="text-eve-muted">Tagline</dt><dd>{product.tagline}</dd>
            <dt className="text-eve-muted">Support</dt><dd>{product.supportEmail}</dd>
            <dt className="text-eve-muted">Theme</dt><dd>{product.defaultTheme}</dd>
          </dl>
        </Card>
      </div>
    </OrganiserShell>
  );
}
