"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/titlecase";
import { TwoFactorPanel } from "@/components/dashboard/two-factor-panel";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Update Your Name?", message: `Change your display name to "${fullName}"?` });
    if (!confirmed) return;
    setSavingName(true);
    try {
      await api.patch("/v1/profile", { full_name: fullName });
      await refresh();
      toast.success("Profile updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    const confirmed = await confirm({ title: "Change Your Password?", message: "You'll need your new password next time you log in." });
    if (!confirmed) return;
    setSavingPassword(true);
    try {
      await api.post("/v1/profile/password", {
        current_password: currentPassword,
        new_password: newPassword,
        repeat_password: repeatPassword,
      });
      toast.success("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div id="page-profile" className="c-profile">
      <h1 className="c-profile__title text-[26px] leading-8 font-semibold text-foreground">Profile</h1>

      <div className="c-profile__grid mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form
          id="profile-name-form"
          onSubmit={handleSaveName}
          className="c-profile__name flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Personal Information</h2>
          <Input id="profile-fullname" label="Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input id="profile-email" label="Email" value={user?.email ?? ""} disabled className="cursor-not-allowed" />
          <Input id="profile-role" label="Role" value={toTitleCase(user?.role ?? "")} disabled className="cursor-not-allowed" />
          <div>
            <Button id="profile-name-save" type="submit" variant="primary" disabled={savingName}>
              {savingName ? "saving" : "save changes"}
            </Button>
          </div>
        </form>

        <form
          id="profile-password-form"
          onSubmit={handleChangePassword}
          className="c-profile__password flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Change Password</h2>
          <PasswordInput
            id="profile-current-password"
            label="Current Password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <PasswordInput id="profile-new-password" label="New Password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <PasswordInput
            id="profile-repeat-password"
            label="Repeat New Password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <div>
            <Button id="profile-password-save" type="submit" variant="primary" disabled={savingPassword}>
              {savingPassword ? "saving" : "change password"}
            </Button>
          </div>
        </form>
      </div>

      <TwoFactorPanel />
    </div>
  );
}
