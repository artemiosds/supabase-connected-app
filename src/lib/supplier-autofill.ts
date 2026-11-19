type FormWithOrigin = { automaticFields: string[] };

export function fillEmptySupplierFields<T extends FormWithOrigin>(
  form: T,
  values: Partial<Record<Extract<keyof T, string>, string>>,
): T {
  const next = { ...form, automaticFields: [...form.automaticFields] };
  for (const [field, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim() && form[field as keyof T] === "") {
      Object.assign(next, { [field]: value });
      next.automaticFields.push(field);
    }
  }
  return next;
}

export function clearSupplierAutofill<T extends FormWithOrigin>(form: T): T {
  const next = { ...form, automaticFields: [] };
  for (const field of form.automaticFields) Object.assign(next, { [field]: "" });
  return next;
}
