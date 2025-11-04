import React, { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Infer, Validator } from "convex/values";
import { validate, ValidationError } from "convex-helpers/validators";

const JsonEditor = <V extends Validator<any, "required", any>>({
  defaultValue,
  onChange,
  validator,
}: {
  defaultValue: Infer<V>;
  onChange?: (value: Infer<V>) => void;
  validator: V;
}) => {
  const [value, setValue] = useState<Infer<V> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setValue(null);
    setError(null);
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (newValue === "") {
      reset();
      return;
    }
    setValue(newValue);

    try {
      const parsedJson = JSON.parse(newValue);
      if (validate(validator, parsedJson, { throw: true })) {
        setError(null);
        onChange?.(parsedJson);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
      } else {
        setError("Invalid JSON");
      }
    }
  };
  return (
    <div className="w-full">
      <Textarea
        value={value ?? JSON.stringify(defaultValue, null, 2)}
        onChange={handleChange}
        className="font-mono text-sm h-72"
        rows={5}
      />
      {error && <p className="text-destructive text-sm mt-1">{error}</p>}
    </div>
  );
};

export default JsonEditor;
