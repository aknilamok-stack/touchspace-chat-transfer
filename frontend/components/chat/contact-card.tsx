"use client";

import { useState } from "react";

export type ChatContactItem = {
  id: string;
  type: "email" | "phone";
  value: string;
  label?: string | null;
  source: "manual" | "profile";
  sourceLabel: string;
  editable: boolean;
};

type ContactDraft = {
  type: "email" | "phone";
  value: string;
};

type ContactCardProps = {
  contacts: ChatContactItem[];
  canManage: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string;
  title?: string;
  onAdd?: (draft: ContactDraft) => Promise<void>;
  onUpdate?: (contactId: string, draft: ContactDraft) => Promise<void>;
  onDelete?: (contactId: string) => Promise<void>;
};

const defaultDraft: ContactDraft = {
  type: "email",
  value: "",
};

const typeLabel: Record<ContactDraft["type"], string> = {
  email: "Email",
  phone: "Телефон",
};

const typeBadgeClassName: Record<ContactDraft["type"], string> = {
  email: "bg-[#EEF6FF] text-[#0A84FF]",
  phone: "bg-[#ECFFF1] text-[#1F8B4C]",
};

const typePlaceholder: Record<ContactDraft["type"], string> = {
  email: "Email не указан",
  phone: "Телефон не указан",
};

export function ContactCard({
  contacts,
  canManage,
  isLoading = false,
  isSaving = false,
  error,
  title = "Контакты",
  onAdd,
  onUpdate,
  onDelete,
}: ContactCardProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(defaultDraft);
  const [editingContactId, setEditingContactId] = useState("");

  const startAdd = () => {
    setEditingContactId("");
    setDraft(defaultDraft);
    setIsFormOpen(true);
  };

  const startEdit = (contact: ChatContactItem) => {
    setEditingContactId(contact.id);
    setDraft({
      type: contact.type,
      value: contact.value,
    });
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setEditingContactId("");
    setDraft(defaultDraft);
    setIsFormOpen(false);
  };

  const startAddWithType = (type: ContactDraft["type"]) => {
    setEditingContactId("");
    setDraft({
      type,
      value: "",
    });
    setIsFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!draft.value.trim()) {
      return;
    }

    if (editingContactId) {
      await onUpdate?.(editingContactId, draft);
    } else {
      await onAdd?.(draft);
    }

    resetForm();
  };

  const submitLabel = editingContactId ? "Сохранить" : "Добавить";
  const primaryEmailContact = contacts.find((contact) => contact.type === "email") ?? null;
  const primaryPhoneContact = contacts.find((contact) => contact.type === "phone") ?? null;
  const additionalContacts = contacts.filter(
    (contact) =>
      contact.id !== primaryEmailContact?.id && contact.id !== primaryPhoneContact?.id
  );

  const renderContactRow = (contact: ChatContactItem | null, type: ContactDraft["type"]) => {
    const isMissingContact = !contact;
    const canEditContact = canManage && (!!contact?.editable || isMissingContact);

    return (
      <div className="flex items-center gap-2 rounded-[18px] border border-[#ECECF1] bg-[#FBFBFD] px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${typeBadgeClassName[type]}`}
        >
          {typeLabel[type]}
        </span>

        <p
          className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${
            contact ? "font-medium text-[#1E1E1E]" : "text-[#8E8E93]"
          }`}
          title={contact?.value || typePlaceholder[type]}
        >
          {contact?.value || typePlaceholder[type]}
        </p>

        {canEditContact ? (
          <button
            type="button"
            onClick={() => {
              if (contact) {
                startEdit(contact);
              } else {
                startAddWithType(type);
              }
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5E5EA] bg-white text-[15px] text-[#8E8E93] shadow-[0_4px_12px_rgba(15,23,42,0.05)] transition hover:bg-[#F5F8FF] hover:text-[#0A84FF]"
            aria-label={contact ? `Изменить ${typeLabel[type]}` : `Добавить ${typeLabel[type]}`}
            title={contact ? `Изменить ${typeLabel[type]}` : `Добавить ${typeLabel[type]}`}
          >
            ✎
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mb-4 rounded-[24px] border border-[#E5E5EA] bg-white p-4 shadow-sm">
      <p className="text-[15px] font-semibold text-[#1E1E1E]">{title}</p>

      <div className="mt-3 space-y-2.5">
        {isLoading ? (
          <p className="text-sm text-[#8E8E93]">Загружаем контакты...</p>
        ) : (
          <>
            {renderContactRow(primaryEmailContact, "email")}
            {renderContactRow(primaryPhoneContact, "phone")}
            {additionalContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-2 rounded-[18px] border border-[#ECECF1] bg-[#FBFBFD] px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
              >
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${typeBadgeClassName[contact.type]}`}
                >
                  {typeLabel[contact.type]}
                </span>
                <p
                  className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-[#1E1E1E]"
                  title={contact.value}
                >
                  {contact.value}
                </p>
                {canManage && contact.editable ? (
                  <button
                    type="button"
                    onClick={() => startEdit(contact)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5E5EA] bg-white text-[15px] text-[#8E8E93] shadow-[0_4px_12px_rgba(15,23,42,0.05)] transition hover:bg-[#F5F8FF] hover:text-[#0A84FF]"
                    aria-label={`Изменить ${typeLabel[contact.type]}`}
                    title={`Изменить ${typeLabel[contact.type]}`}
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>

      {canManage ? (
        <>
          {!isFormOpen ? (
            additionalContacts.length > 0 ? (
              <button
                type="button"
                onClick={startAdd}
                className="mt-3 w-full rounded-2xl border border-[#D9E5FA] bg-[#F5F9FF] py-2.5 text-sm font-medium text-[#0A84FF] transition hover:bg-[#ECF4FF]"
              >
                Добавить контакт
              </button>
            ) : null
          ) : (
            <div className="mt-4 rounded-[20px] border border-[#E5E5EA] bg-[#FBFBFD] p-3">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-[420px]:grid-cols-1">
                <select
                  value={draft.type}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      type: event.target.value as ContactDraft["type"],
                    }))
                  }
                  className="rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none"
                >
                  <option value="email">Email</option>
                  <option value="phone">Телефон</option>
                </select>

                <input
                  value={draft.value}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      value: event.target.value,
                    }))
                  }
                  placeholder={draft.type === "email" ? "name@company.ru" : "+7 999 123-45-67"}
                  className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none"
                />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={isSaving || !draft.value.trim()}
                  className="rounded-2xl bg-[#0A84FF] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0077F2] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? "Сохраняем..." : submitLabel}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-2xl bg-[#F2F2F7] px-4 py-2.5 text-sm font-medium text-[#6C6C70] transition hover:bg-[#E8E8EE]"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[#D63E3E]">{error}</p> : null}
    </div>
  );
}
