import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "../ui/primitives.jsx";

export default function MarkdownElement({ element }) {
  return (
    <Card>
      <CardContent className="prose-chat text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{element.content}</ReactMarkdown>
      </CardContent>
    </Card>
  );
}
