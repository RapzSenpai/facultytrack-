import React from 'react';

/**
 * Form field wrapper: uppercase label with required "*" or "(optional)" marker,
 * the input/select as children, plus optional hint and error lines.
 */
export default function AuthField({ label, htmlFor, required = false, optional = false, hint, error, span2 = false, icon: Icon, children }) {
  return (
    <div className={span2 ? "auth-field-group auth-field-group--span2" : "auth-field-group"}>
      <label className="auth-label" htmlFor={htmlFor}>
        {label}{" "}
        {optional && <span className="auth-optional">(optional)</span>}
      </label>
      
      {Icon ? (
        <div className="auth-input-with-icon">
          <Icon className="auth-input-icon-left" size={16} />
          {children}
        </div>
      ) : (
        children
      )}
      
      {error ? (
        <p className="auth-field-error" role="alert">{error}</p>
      ) : hint ? (
        <p className="auth-hint">{hint}</p>
      ) : null}
    </div>
  );
}

