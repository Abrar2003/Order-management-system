export const createOmsAssistantState = () => ({
  status: "idle",
  error: "",
  conversationId: "",
  messages: [],
});

export const omsAssistantReducer = (state, action) => {
  switch (action.type) {
    case "submit":
      return {
        ...state,
        status: "loading",
        error: "",
        messages: [
          ...state.messages,
          {
            id: action.payload.id,
            role: "user",
            text: action.payload.message,
          },
        ],
      };
    case "success":
      return {
        ...state,
        status: "success",
        error: "",
        conversationId: action.payload.conversationId || state.conversationId,
        messages: [
          ...state.messages,
          {
            id: action.payload.id,
            role: "assistant",
            text: action.payload.answer,
            metadata: action.payload.metadata || {},
            rows: Array.isArray(action.payload.rows) ? action.payload.rows : [],
          },
        ],
      };
    case "error":
      return {
        ...state,
        status: "error",
        error: action.payload.message,
      };
    default:
      return state;
  }
};
