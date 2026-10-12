import UkDateInput from "./UkDateInput";

export default function Input({
  className = "",
  placeholder,
  value,
  ...props
}) {
  if (props.type === "date") {
    // Dates are typed and shown dd/mm/yyyy (QA R7); callers still get an event-like { target: { value } } in ISO.
    const { type: _type, onChange, ...rest } = props;
    return <UkDateInput {...rest} value={value || ""} className={"ea-input " + className}
      onChange={(v) => onChange?.({ target: { value: v, name: props.name } })} />;
  }
  return (
    <input
      {...props}
      placeholder={value ? null : placeholder}
      value={value}
      className={"ea-input " + className}
    />
  );
}
