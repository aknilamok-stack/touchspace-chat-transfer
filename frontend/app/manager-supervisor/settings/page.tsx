import { OperatorsSettingsPage } from "@/components/supervisor/operators-settings-page";

export default function ManagerSupervisorSettingsPage() {
  return (
    <OperatorsSettingsPage
      scope="manager_supervisor"
      title="Настройки"
      subtitle="Управление операторами TouchSpace: статусы, доступ к чатам, логины, email и сброс временных паролей."
      backHref="/manager-supervisor"
    />
  );
}
