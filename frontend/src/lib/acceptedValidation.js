export function getAcceptedServiceValidationEntry(data) {
  const history = Array.isArray(data?.service_validation_history) ? data.service_validation_history : [];
  const activeId = data?.active_service_validation_id;
  const activeEntry = activeId ? history.find((item) => item?.id === activeId) : null;
  if (activeEntry?.decision_status === "accepted") return activeEntry;
  return history.find((item) => item?.decision_status === "accepted") || null;
}

export function getAcceptedBusinessValidation(data) {
  return data?.decision?.status === "accepted" ? data?.idea_validation || null : null;
}

export function getAcceptedWorkspaceValidation(data) {
  return {
    businessValidation: getAcceptedBusinessValidation(data),
    serviceValidation: getAcceptedServiceValidationEntry(data)?.result || null,
  };
}
