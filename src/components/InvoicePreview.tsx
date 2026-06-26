interface Props {
  pageUrls: string[];
  currentPage: number;
  onPageChange: (n: number) => void;
}

export function InvoicePreview({ pageUrls, currentPage, onPageChange }: Props) {
  if (pageUrls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-slate-200 shadow-sm bg-slate-50">
        <img
          src={pageUrls[currentPage]}
          alt={`Invoice page ${currentPage + 1}`}
          className="w-full h-auto rounded-xl"
        />
      </div>

      {pageUrls.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            Previous
          </button>
          <span className="text-sm text-slate-600">
            {currentPage + 1} / {pageUrls.length}
          </span>
          <button
            onClick={() =>
              onPageChange(Math.min(pageUrls.length - 1, currentPage + 1))
            }
            disabled={currentPage === pageUrls.length - 1}
            className="px-3 py-1 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
