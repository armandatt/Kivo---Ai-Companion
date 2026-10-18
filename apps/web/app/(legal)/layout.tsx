import { THEME_SCRIPT } from "@/components/theme/kivo-theme"
import { Footer } from "@/components/footer"

// The Privacy Policy and the Terms. Public pages, drawn in the theme the
// learner chose in the app (ink or paper), with the site's footer.
export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Sets the theme before anything paints. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
      <Footer />
    </>
  )
}
