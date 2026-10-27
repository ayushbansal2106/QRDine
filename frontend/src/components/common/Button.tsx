import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  fullWidth = false,
  className = "",
  type = "button",
  ...props
}) => {
  const baseStyle =
    "font-inter font-semibold text-label-md px-lg py-sm rounded-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-xs";

  const variants = {
    primary: "bg-primary text-on-primary hover:bg-primary-container",
    secondary:
      "border border-primary text-primary bg-surface-container-lowest hover:bg-surface-container-low shadow-[0px_4px_20px_rgba(0,0,0,0.02)]",
    danger: "bg-error text-on-primary hover:opacity-95",
    ghost:
      "text-on-surface-variant hover:bg-surface-container-low shadow-none",
    outline:
      "border border-primary text-primary bg-transparent hover:bg-primary/10",
  };

  return (
    <button
      type={type}
      className={`${baseStyle} ${variants[variant]} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
export default Button;
