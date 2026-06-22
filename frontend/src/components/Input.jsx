export default function Input({
  className = "",
  placeholder,
  value,
  ...props
}) {
  return (
    <input
      {...props}
      placeholder={value ? null : placeholder}
      value={value}
      className={"ea-input " + className}
    />
  );
}
