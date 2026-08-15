import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="py-12">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That route does not exist in the MedBridge operations portal."
        action={
          <Button asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  )
}
