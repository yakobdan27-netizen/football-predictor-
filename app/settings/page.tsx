import { SettingsApp } from "@/components/prediction-log/settings-app";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Batch entry preferences and combined-odds engine configuration. Stored locally in your browser.
      </p>
      <SettingsApp />
    </div>
  );
}
