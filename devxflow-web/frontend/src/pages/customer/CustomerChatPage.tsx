import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useSocket } from '../../hooks/useSocket'
import { ChatWindow } from '../../components/chat/ChatWindow'

export function CustomerChatPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  
  // Get customer info from localStorage
  const customerData = localStorage.getItem('customer')
  const token = localStorage.getItem('token')
  const customer = customerData ? JSON.parse(customerData) : null
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!token || !customer) {
      navigate('/login')
    }
  }, [token, customer, navigate])
  
  // Don't render if not authenticated
  if (!token || !customer) {
    return null
  }
  
  const userId = customer.id || customerId
  
  const {
    isConnected,
    messages,
    sendMessage,
    sendTyping,
    isUserTyping,
    error
  } = useSocket({
    userId,
    role: 'customer',
    customerId: userId
  })

  return (
    <div className="customer-chat-page">
      <div className="chat-widget">
        <div className="chat-widget-header">
          <div className="header-left">
            <h2>Support Chat</h2>
            <span className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? 'Online' : 'Offline'}
            </span>
          </div>
          {isUserTyping && (
            <span className="typing-indicator">typing...</span>
          )}
        </div>
        
        {error && (
          <div className="chat-error">
            {error}
          </div>
        )}
        
        <div className="chat-widget-body">
          <ChatWindow
            messages={messages}
            isConnected={isConnected}
            onSendMessage={sendMessage}
            onTyping={sendTyping}
            currentUserId={userId}
          />
        </div>
      </div>
    </div>
  )
}
