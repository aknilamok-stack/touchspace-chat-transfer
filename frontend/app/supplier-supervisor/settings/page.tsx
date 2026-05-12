import { OperatorsSettingsPage } from "@/components/supervisor/operators-settings-page";

export default function SupplierSupervisorSettingsPage() {
  return (
    <OperatorsSettingsPage
      scope="supplier_supervisor"
      title="Настройки"
      subtitle="Управление операторами поставщика: статусы, доступ к чатам, логины, email и сброс временных паролей."
      backHref="/supplier-supervisor"
    />
  );
}
