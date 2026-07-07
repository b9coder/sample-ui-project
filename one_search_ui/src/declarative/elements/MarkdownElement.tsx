import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import type { UIComponent } from "../types";

export function MarkdownElement({ component }: { component: UIComponent }) {
  return (
    <Card className="py-4">
      <CardContent className="px-5">
        <div className="prose-declarative text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h4]:mb-2 [&_h4]:mt-0 [&_h4]:text-base [&_h4]:font-semibold [&_li]:my-1 [&_p]:my-1 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{component.markdown ?? ""}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
