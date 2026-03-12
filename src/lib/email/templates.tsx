import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
} from '@react-email/components'

const baseStyle = {
  backgroundColor: '#111113',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const containerStyle = {
  margin: '0 auto',
  padding: '40px 24px',
  maxWidth: '560px',
}

const headingStyle = {
  color: '#ffffff',
  fontSize: '22px',
  fontWeight: '600' as const,
  margin: '0 0 16px',
}

const textStyle = {
  color: '#a1a1aa',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 12px',
}

const hrStyle = {
  borderColor: '#27272a',
  margin: '24px 0',
}

const footerStyle = {
  color: '#52525b',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '0',
}

const buttonStyle = {
  backgroundColor: '#f59e0b',
  borderRadius: '6px',
  color: '#000000',
  display: 'inline-block' as const,
  fontSize: '14px',
  fontWeight: '600' as const,
  padding: '10px 24px',
  textDecoration: 'none',
}

interface FollowupEmailProps {
  leadName: string
  businessName: string
  summary: string
  lastContactDate?: string
  dashboardUrl?: string
}

export function FollowupEmail({
  leadName,
  businessName,
  summary,
  lastContactDate,
  dashboardUrl,
}: FollowupEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Follow-up from {businessName}</Preview>
      <Body style={baseStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Follow-up from {businessName}</Heading>
          <Text style={textStyle}>Hi {leadName},</Text>
          <Text style={textStyle}>{summary}</Text>
          {lastContactDate && (
            <Text style={{ ...textStyle, color: '#71717a', fontSize: '13px' }}>
              Last contact: {lastContactDate}
            </Text>
          )}
          {dashboardUrl && (
            <Section style={{ margin: '24px 0' }}>
              <Link href={dashboardUrl} style={buttonStyle}>
                View Details
              </Link>
            </Section>
          )}
          <Hr style={hrStyle} />
          <Text style={footerStyle}>Sent by {businessName} via RecommendMe</Text>
        </Container>
      </Body>
    </Html>
  )
}

interface ReminderEmailProps {
  leadName: string
  businessName: string
  appointmentDate: string
  appointmentTime: string
  summary: string
  dashboardUrl?: string
}

export function ReminderEmail({
  leadName,
  businessName,
  appointmentDate,
  appointmentTime,
  summary,
  dashboardUrl,
}: ReminderEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Appointment reminder: {appointmentDate} at {appointmentTime}
      </Preview>
      <Body style={baseStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Appointment Reminder</Heading>
          <Text style={textStyle}>Hi {leadName},</Text>
          <Text style={textStyle}>
            This is a reminder about your upcoming appointment with {businessName}.
          </Text>
          <Section
            style={{
              backgroundColor: '#18181b',
              borderRadius: '8px',
              padding: '16px 20px',
              margin: '16px 0',
              border: '1px solid #27272a',
            }}
          >
            <Text style={{ ...textStyle, color: '#ffffff', fontWeight: '600', margin: '0 0 4px' }}>
              {appointmentDate} at {appointmentTime}
            </Text>
            <Text style={{ ...textStyle, margin: '0' }}>{summary}</Text>
          </Section>
          {dashboardUrl && (
            <Section style={{ margin: '24px 0' }}>
              <Link href={dashboardUrl} style={buttonStyle}>
                View Appointment
              </Link>
            </Section>
          )}
          <Hr style={hrStyle} />
          <Text style={footerStyle}>Sent by {businessName} via RecommendMe</Text>
        </Container>
      </Body>
    </Html>
  )
}

interface InvoiceEmailProps {
  leadName: string
  businessName: string
  invoiceNumber: string
  amount: string
  dueDate: string
  summary: string
  dashboardUrl?: string
}

export function InvoiceEmail({
  leadName,
  businessName,
  invoiceNumber,
  amount,
  dueDate,
  summary,
  dashboardUrl,
}: InvoiceEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Invoice {invoiceNumber} from {businessName} — {amount}
      </Preview>
      <Body style={baseStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Invoice from {businessName}</Heading>
          <Text style={textStyle}>Hi {leadName},</Text>
          <Text style={textStyle}>{summary}</Text>
          <Section
            style={{
              backgroundColor: '#18181b',
              borderRadius: '8px',
              padding: '16px 20px',
              margin: '16px 0',
              border: '1px solid #27272a',
            }}
          >
            <Text style={{ ...textStyle, color: '#ffffff', fontWeight: '600', margin: '0 0 4px' }}>
              Invoice #{invoiceNumber}
            </Text>
            <Text style={{ ...textStyle, margin: '0 0 4px' }}>Amount: {amount}</Text>
            <Text style={{ ...textStyle, margin: '0' }}>Due: {dueDate}</Text>
          </Section>
          {dashboardUrl && (
            <Section style={{ margin: '24px 0' }}>
              <Link href={dashboardUrl} style={buttonStyle}>
                View Invoice
              </Link>
            </Section>
          )}
          <Hr style={hrStyle} />
          <Text style={footerStyle}>Sent by {businessName} via RecommendMe</Text>
        </Container>
      </Body>
    </Html>
  )
}

interface GenericEmailProps {
  recipientName: string
  businessName: string
  subject: string
  body: string
  dashboardUrl?: string
}

export function GenericEmail({
  recipientName,
  businessName,
  subject,
  body,
  dashboardUrl,
}: GenericEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={baseStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>{subject}</Heading>
          <Text style={textStyle}>Hi {recipientName},</Text>
          <Text style={textStyle}>{body}</Text>
          {dashboardUrl && (
            <Section style={{ margin: '24px 0' }}>
              <Link href={dashboardUrl} style={buttonStyle}>
                Learn More
              </Link>
            </Section>
          )}
          <Hr style={hrStyle} />
          <Text style={footerStyle}>Sent by {businessName} via RecommendMe</Text>
        </Container>
      </Body>
    </Html>
  )
}

export type EmailTemplate = 'followup' | 'reminder' | 'invoice' | 'generic'

export interface RenderEmailOptions {
  template: EmailTemplate
  props: Record<string, string | undefined>
}

export async function renderEmailHtml(options: RenderEmailOptions): Promise<string> {
  const { template, props } = options

  switch (template) {
    case 'followup':
      return await render(
        <FollowupEmail
          leadName={props.leadName ?? 'there'}
          businessName={props.businessName ?? 'Our Team'}
          summary={props.summary ?? ''}
          lastContactDate={props.lastContactDate}
          dashboardUrl={props.dashboardUrl}
        />
      )
    case 'reminder':
      return await render(
        <ReminderEmail
          leadName={props.leadName ?? 'there'}
          businessName={props.businessName ?? 'Our Team'}
          appointmentDate={props.appointmentDate ?? ''}
          appointmentTime={props.appointmentTime ?? ''}
          summary={props.summary ?? ''}
          dashboardUrl={props.dashboardUrl}
        />
      )
    case 'invoice':
      return await render(
        <InvoiceEmail
          leadName={props.leadName ?? 'there'}
          businessName={props.businessName ?? 'Our Team'}
          invoiceNumber={props.invoiceNumber ?? ''}
          amount={props.amount ?? '$0.00'}
          dueDate={props.dueDate ?? ''}
          summary={props.summary ?? ''}
          dashboardUrl={props.dashboardUrl}
        />
      )
    case 'generic':
      return await render(
        <GenericEmail
          recipientName={props.recipientName ?? 'there'}
          businessName={props.businessName ?? 'Our Team'}
          subject={props.subject ?? ''}
          body={props.body ?? ''}
          dashboardUrl={props.dashboardUrl}
        />
      )
  }
}
