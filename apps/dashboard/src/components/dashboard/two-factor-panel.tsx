"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TrashIcon } from "@/components/icons";

type DeviceRow = {
  id: number;
  device_label: string;
  ip: string;
  country: string;
  city: string;
  last_used_at: string;
  created_at: string;
};

type StatusResponse = {
  enabled: boolean;
  devices: DeviceRow[];
  max_devices: number;
  devices_used: number;
};

export function TwoFactorPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const res = await api.get<StatusResponse>("/v1/profile/2fa");
      setStatus(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load 2FA status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Genuine data-fetch-on-mount, not state derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartEnroll() {
    setEnrolling(true);
    setError(null);
    try {
      const res = await api.post<{ secret: string; qr_code: string }>("/v1/profile/2fa/enroll");
      setSecret(res.secret);
      setQrCode(res.qr_code);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start 2FA setup.");
      setEnrolling(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      await api.post("/v1/profile/2fa/verify", { code });
      toast.success("2FA enabled successfully.");
      setEnrolling(false);
      setQrCode(null);
      setSecret(null);
      setCode("");
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleRemoveDevice(device: DeviceRow) {
    const confirmed = await confirm({
      title: "Remove This Device?",
      message: `"${device.device_label}" will need to verify with a code again next time it logs in. Removing it frees a slot for a new device.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/v1/profile/2fa/devices/${device.id}`);
      toast.success("Device removed successfully.");
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  if (loading) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  return (
    <div id="profile-2fa" className="c-profile__2fa mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-foreground">Two-Factor Authentication</h2>

      {!status?.enabled && !enrolling && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground-muted">
            Add an extra layer of security to your account. Once enabled, you&apos;ll scan a QR code with an authenticator app (Google Authenticator, Authy, etc) and enter a
            code to confirm.
          </p>
          <div>
            <Button id="profile-2fa-start" type="button" variant="primary" onClick={handleStartEnroll}>
              enable 2fa
            </Button>
          </div>
        </div>
      )}

      {enrolling && qrCode && (
        <form id="profile-2fa-enroll-form" onSubmit={handleVerify} className="flex flex-col gap-4">
          <p className="text-sm text-foreground-muted">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
          <img id="profile-2fa-qr" src={qrCode} alt="2FA QR Code" className="h-48 w-48 rounded-md border border-border bg-white p-2" />
          {secret && (
            <p className="text-xs text-foreground-muted">
              Can&apos;t scan it? Enter this key manually: <span className="font-mono">{secret}</span>
            </p>
          )}
          <Input id="profile-2fa-code" label="Verification Code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button id="profile-2fa-verify" type="submit" variant="primary" disabled={verifying}>
              {verifying ? "verifying" : "verify and enable"}
            </Button>
            <Button
              id="profile-2fa-cancel-enroll"
              type="button"
              variant="ghost"
              onClick={() => {
                setEnrolling(false);
                setQrCode(null);
                setSecret(null);
                setCode("");
              }}
            >
              cancel
            </Button>
          </div>
        </form>
      )}

      {status?.enabled && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground-muted">
            2FA is enabled. Up to {status.max_devices} browsers/devices can be trusted at once ({status.devices_used}/{status.max_devices} used) — remove one below to trust a
            new one at its next login.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-surface-alt text-foreground-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Trusted Since</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {status.devices.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-foreground-muted">
                      No trusted devices yet.
                    </td>
                  </tr>
                )}
                {status.devices.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-4 py-3 text-foreground">{d.device_label}</td>
                    <td className="px-4 py-3 text-foreground">{[d.city, d.country].filter(Boolean).join(", ") || "Local Network"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">{new Date(d.last_used_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <IconButton id={`profile-2fa-remove-${d.id}`} icon={<TrashIcon />} label="Remove Device" variant="danger" onClick={() => handleRemoveDevice(d)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
