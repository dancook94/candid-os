export function formatPrintFactoryLinkedJobsLabel(linkedJobCount: number) {
  if (linkedJobCount <= 0) {
    return null;
  }

  if (linkedJobCount === 1) {
    return "PrintFactory: 1 job linked";
  }

  return `PrintFactory: ${linkedJobCount} jobs linked`;
}
